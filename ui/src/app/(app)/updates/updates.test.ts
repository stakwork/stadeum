import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postHistory } from "@/app/api/ops/history/route";
import { GET as getSettings } from "@/app/api/ops/settings/route";
import { PUT as putStatus } from "@/app/api/ops/status/route";
import { admit } from "@/lib/access";
import { db } from "@/lib/db";
import type { OpsEvent, OpsSettings, OpsStatus } from "@/lib/ops/contract";
import type { UpdatesNow } from "@/lib/ops/progress";

/**
 * Check now and Update now end to end in stadeum-ui: the admin's click
 * (the server actions), ops's side of it played through its own routes,
 * and what the page re-reads (`GET /api/updates`) at each step.
 */

const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { checkNow, updateNow } = await import("./actions");
const { GET: live } = await import("@/app/api/updates/route");

const TOKEN = "updates-test-token";

beforeEach(async () => {
  process.env.SHARED_API_TOKEN = TOKEN;
  process.env.STADEUM_ALLOWED_DOMAINS = "acme.test";
  await db.opsStatus.deleteMany();
  await db.opsRequest.deleteMany();
  await db.opsEvent.deleteMany();
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await admit("ada@acme.test"); // the first person: an admin
  await admit("ben@acme.test");
  who.email = "ada@acme.test";
});
afterAll(() => db.$disconnect());

// ── ops, as it talks to stadeum-ui ──────────────────────────────────────

const ops = (method: string, body?: unknown) =>
  new Request("http://stadeum-ui:3000/api/ops", {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const opsReads = async () => (await (await getSettings(ops("GET"))).json()) as OpsSettings;
const opsSays = async (patch: Partial<OpsStatus>) => {
  const res = await putStatus(ops("PUT", { phase: "idle", version: "ops-1", services: SERVICES, checkedAt: new Date().toISOString(), ...patch }));
  expect(res.status).toBe(204);
};
const opsRecords = async (outcome: OpsEvent["outcome"], detail: string) => {
  const at = new Date().toISOString();
  expect((await postHistory(ops("POST", { kind: "update", outcome, startedAt: at, endedAt: at, detail }))).status).toBe(201);
};

const SERVICES: OpsStatus["services"] = [
  { service: "strut", image: "ghcr.io/stakwork/strut:stable", group: "strut", latest: { checkedAt: new Date().toISOString(), digest: "sha256:a", current: true } },
];

// ── the page ────────────────────────────────────────────────────────────

const page = async () => {
  const res = await live();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as UpdatesNow;
};
const shown = async (kind: "update" | "check") => (await page()).requests.find((r) => r.kind === kind);

describe("Update now", () => {
  it("is waiting, then shows ops's steps, then what came of it", async () => {
    await opsSays({});
    await updateNow();
    expect(await shown("update")).toMatchObject({ state: "waiting", note: "ops takes it up within half a minute." });

    // ops takes it up.
    const [asked] = (await opsReads()).requests;
    expect(asked?.kind).toBe("update");
    await opsSays({ phase: "checking" });
    expect(await shown("update")).toMatchObject({ state: "working", step: { phase: "checking" } });
    await opsSays({ phase: "draining", detail: "updating strut 5c3fb86 → d306035: waiting on 1 run and 0 chats" });
    expect(await shown("update")).toMatchObject({ state: "working", step: { phase: "draining", detail: "updating strut 5c3fb86 → d306035: waiting on 1 run and 0 chats" } });
    await opsSays({ phase: "updating", detail: "strut 5c3fb86 → d306035" });
    expect(await shown("update")).toMatchObject({ state: "working", step: { phase: "updating" } });

    // It records what it did, then says it is done.
    await opsRecords("ok", "Updated strut 5c3fb86 → d306035 in 1 min.");
    await opsSays({ phase: "idle", done: [asked!.id] });
    expect(await shown("update")).toMatchObject({ state: "ended", tone: "ok", label: "Updated", notes: ["Updated strut 5c3fb86 → d306035 in 1 min."] });
    // ops's state shows again under it.
    expect((await page()).heard).toMatchObject({ phase: "idle" });
  });

  it("says a rollback, and why", async () => {
    await updateNow();
    const [asked] = (await opsReads()).requests;
    await opsSays({ phase: "rolling-back", detail: "strut 5c3fb86 → 9a1b2c3" });
    expect(await shown("update")).toMatchObject({ state: "working", step: { phase: "rolling-back" } });
    await opsRecords("rolled-back", "strut 5c3fb86 → 9a1b2c3 did not come up healthy, so the images it replaced were put back. strut's /health: strut is not ok");
    await opsSays({ done: [asked!.id] });
    expect(await shown("update")).toMatchObject({
      state: "ended",
      tone: "attention",
      label: "Rolled back",
      notes: [expect.stringContaining("strut's /health: strut is not ok")],
    });
  });

  it("says when there was nothing to update", async () => {
    await updateNow();
    const [asked] = (await opsReads()).requests;
    await opsSays({ phase: "checking" });
    await opsSays({ done: [asked!.id] });
    expect(await shown("update")).toMatchObject({ state: "ended", tone: "ok", label: "Nothing to update", notes: ["Everything is current: strut runs what its channel names."] });
  });

  it("follows the release it hands over until that one records its outcome", async () => {
    await updateNow();
    const [asked] = (await opsReads()).requests;
    await opsRecords("ok", "Updated strut 5c3fb86 → d306035 in 1 min.");
    await opsSays({ phase: "updating", detail: "Handing release 1a2b3c4 → 5d6e7f8 to the ops it brings", done: [asked!.id] });
    expect((await opsReads()).requests).toEqual([]);
    expect(await shown("update")).toMatchObject({ state: "working", step: { detail: "Handing release 1a2b3c4 → 5d6e7f8 to the ops it brings" } });
    await new Promise((r) => setTimeout(r, 5)); // the release's record comes after the request was marked done
    await opsRecords("ok", "Updated release 1a2b3c4 → 5d6e7f8; recreated stadeum-ui, ops, in 40 s.");
    await opsSays({});
    expect(await shown("update")).toMatchObject({ state: "ended", label: "Updated", notes: [expect.stringMatching(/^Done: Updated strut/), expect.stringMatching(/^Done: Updated release/)] });
  });

  it("asked again while one is open shows the open one, never a second", async () => {
    await updateNow();
    const first = await shown("update");
    await updateNow();
    expect((await opsReads()).requests).toHaveLength(1);
    expect(await shown("update")).toEqual(first);
  });
});

describe("Check now", () => {
  it("is waiting, checking, then says when it checked and what it found", async () => {
    await checkNow();
    expect(await shown("check")).toMatchObject({ state: "waiting" });
    const [asked] = (await opsReads()).requests;
    await opsSays({ phase: "checking", detail: "Asking the registries what the channels name" });
    expect(await shown("check")).toMatchObject({ state: "working", step: { phase: "checking", detail: "Asking the registries what the channels name" } });
    const newer = { checkedAt: new Date().toISOString(), digest: "sha256:b", current: false, revision: "d306035" };
    await opsSays({ services: [{ ...SERVICES[0]!, latest: newer }], done: [asked!.id] });
    expect(await shown("check")).toMatchObject({
      state: "ended",
      tone: "pending",
      label: "Checked",
      notes: ["strut: d306035 is out. Update now, or the next window, brings it in."],
    });
  });
});

describe("the outcome on the page", () => {
  it("is the last request ops did: an earlier one's goes to History", async () => {
    await checkNow();
    await opsSays({ done: (await opsReads()).requests.map((r) => r.id) });
    expect((await page()).requests.map((r) => [r.kind, r.state])).toEqual([["check", "ended"]]);
    await new Promise((r) => setTimeout(r, 5));

    await updateNow();
    // While it waits, what the check found still shows.
    expect((await page()).requests.map((r) => [r.kind, r.state])).toEqual([
      ["update", "waiting"],
      ["check", "ended"],
    ]);
    await opsRecords("rolled-back", "strut 5c3fb86 → 9a1b2c3 did not come up healthy, so the images it replaced were put back.");
    await opsSays({ done: (await opsReads()).requests.map((r) => r.id) });
    expect((await page()).requests.map((r) => [r.kind, r.state === "ended" ? r.label : r.state])).toEqual([["update", "Rolled back"]]);
    await new Promise((r) => setTimeout(r, 5));

    // Another update: the rolled-back one is History now, and the older check does not come back.
    await updateNow();
    expect((await page()).requests.map((r) => [r.kind, r.state])).toEqual([["update", "waiting"]]);
  });

  it("is the update's when ops answered a check with it", async () => {
    await updateNow();
    await checkNow();
    await opsSays({ done: (await opsReads()).requests.map((r) => r.id) });
    expect((await page()).requests.map((r) => [r.kind, r.state === "ended" ? r.label : r.state])).toEqual([["update", "Nothing to update"]]);
  });
});

describe("GET /api/updates", () => {
  it("answers admins only", async () => {
    who.email = "ben@acme.test";
    expect((await live()).status).toBe(403);
    who.email = null;
    expect((await live()).status).toBe(403);
  });
});
