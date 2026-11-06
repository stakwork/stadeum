import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getSettings } from "@/app/api/ops/settings/route";
import { POST as postHistory } from "@/app/api/ops/history/route";
import { PUT as putStatus } from "@/app/api/ops/status/route";
import { db } from "@/lib/db";
import type { OpsSettings, OpsStatus } from "./contract";
import { history, markPasswordKept, pendingPassword, readStatus, request, saveDestination, saveUpdates, settingsRow } from "./store";

const TOKEN = "ops-test-token";

beforeEach(async () => {
  process.env.SHARED_API_TOKEN = TOKEN;
  await db.opsSettings.deleteMany();
  await db.opsStatus.deleteMany();
  await db.opsRequest.deleteMany();
  await db.opsEvent.deleteMany();
});
afterAll(() => db.$disconnect());

const call = (method: string, body?: unknown, token: string | null = TOKEN) =>
  new Request("http://stadeum-ui:3000/api/ops", {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const settings = async () => (await (await getSettings(call("GET"))).json()) as OpsSettings;

const status = (patch: Partial<OpsStatus> = {}): OpsStatus => ({ phase: "idle", version: "abc1234", services: [], ...patch });

describe("the ops routes", () => {
  it("answer only the deployment key", async () => {
    for (const token of [null, "wrong", `${TOKEN}x`]) {
      expect((await getSettings(call("GET", undefined, token))).status).toBe(401);
      expect((await putStatus(call("PUT", status(), token))).status).toBe(401);
      expect((await postHistory(call("POST", {}, token))).status).toBe(401);
    }
    delete process.env.SHARED_API_TOKEN;
    expect((await getSettings(call("GET", undefined, ""))).status).toBe(401);
  });

  it("give ops working defaults before anyone saves anything", async () => {
    expect(await settings()).toEqual({
      window: { start: "03:00", end: "05:00", timeZone: "UTC" },
      drainMinutes: 30,
      updates: { enabled: true },
      backups: null,
      requests: [],
      lastCycle: null,
      failedImages: [],
    });
  });

  it("hand ops the destination decrypted, and the page only which secrets are saved", async () => {
    expect(await saveDestination("s3", { bucket: "box", accessKeyId: "AKIA", secretAccessKey: "s3cr3t" }, true)).toEqual({ ok: true });
    const row = await settingsRow();
    expect(row.backupSecretsEnc).not.toContain("s3cr3t");
    expect(row.resticPasswordEnc).toMatch(/^v1:/);

    const { backups } = await settings();
    expect(backups).toMatchObject({
      enabled: true,
      repository: "s3:s3.amazonaws.com/box",
      env: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s3cr3t" },
    });
    expect(backups!.password).toHaveLength(32);
  });

  it("keep a saved secret when the form leaves it blank, and the password for good", async () => {
    await saveDestination("s3", { bucket: "box", accessKeyId: "AKIA", secretAccessKey: "s3cr3t" }, true);
    const first = (await settings()).backups!.password;
    await saveDestination("s3", { bucket: "other", accessKeyId: "", secretAccessKey: "" }, false);
    const after = (await settings()).backups!;
    expect(after).toMatchObject({ enabled: false, repository: "s3:s3.amazonaws.com/other", env: { AWS_SECRET_ACCESS_KEY: "s3cr3t" } });
    expect(after.password).toBe(first);
    // Another kind starts without the old kind's secrets.
    expect(await saveDestination("b2", { bucket: "b", keyId: "", applicationKey: "" }, true)).toEqual({ ok: false, error: "Key ID is needed." });
  });

  it("show the password until the admin says it is kept, then never again", async () => {
    expect(await pendingPassword()).toBeNull();
    await saveDestination("local", { path: "/backups/box" }, true);
    const shown = await pendingPassword();
    expect(shown?.kit).toContain(`RESTIC_PASSWORD=${shown?.password}`);
    await markPasswordKept();
    expect(await pendingPassword()).toBeNull();
    // ops still has it.
    expect((await settings()).backups?.password).toBe(shown?.password);
  });

  it("refuse a window that is not one", async () => {
    expect(await saveUpdates({ start: "3:00", end: "05:00", timeZone: "UTC", drainMinutes: 30, enabled: true })).toMatchObject({ ok: false });
    expect(await saveUpdates({ start: "03:00", end: "05:00", timeZone: "Mars/Olympus", drainMinutes: 30, enabled: true })).toMatchObject({ ok: false });
    expect(await saveUpdates({ start: "03:00", end: "05:00", timeZone: "UTC", drainMinutes: 0, enabled: true })).toMatchObject({ ok: false });
    expect(await saveUpdates({ start: "22:30", end: "01:00", timeZone: "Europe/Berlin", drainMinutes: 45, enabled: false })).toEqual({ ok: true });
    expect(await settings()).toMatchObject({ window: { start: "22:30", end: "01:00", timeZone: "Europe/Berlin" }, drainMinutes: 45, updates: { enabled: false } });
  });

  it("list an admin's request until ops says it is done, once per kind", async () => {
    await request("check");
    await request("check");
    await request("update");
    const { requests } = await settings();
    expect(requests.map((r) => r.kind)).toEqual(["check", "update"]);

    const res = await putStatus(call("PUT", status({ done: [requests[0]!.id], lastCycle: "2026-11-05" })));
    expect(res.status).toBe(204);
    const after = await settings();
    expect(after.requests.map((r) => r.kind)).toEqual(["update"]);
    expect(after.lastCycle).toBe("2026-11-05");
  });

  it("hand ops an Upgrade Neo4j with the references the admin agreed to, once per target", async () => {
    await request("confirm", "neo4j:5.26.40");
    await request("confirm", "neo4j:5.26.40");
    await request("confirm", "neo4j:2026.01.0");
    const { requests } = await settings();
    expect(requests.map((r) => [r.kind, r.target])).toEqual([
      ["confirm", "neo4j:5.26.40"],
      ["confirm", "neo4j:2026.01.0"],
    ]);
  });

  it("keep the release ops reports, with what holds it", async () => {
    const release = {
      running: { id: "sha256:ops-1", revision: "1a2b3c4" },
      available: { id: "sha256:ops-2", revision: "5d6e7f8" },
      files: ["stadeum.yml"],
      images: [{ service: "neo4j", from: "neo4j:5.26.32", to: "neo4j:5.26.40" }],
      held: [{ service: "neo4j", from: "neo4j:5.26.32", to: "neo4j:5.26.40" }],
    };
    expect((await putStatus(call("PUT", status({ release })))).status).toBe(204);
    expect((await readStatus())?.status.release).toEqual(release);
    expect((await putStatus(call("PUT", status({ release: { held: [{ service: "neo4j" }] } as never })))).status).toBe(400);
  });

  it("keep what the registry said of each service, and what runs was pulled as", async () => {
    const strut = {
      service: "strut",
      image: "ghcr.io/stakwork/strut:stable",
      group: "strut",
      running: { id: "sha256:fcb2", revision: "5c3fb86", digests: ["sha256:fcb2"] },
      latest: { checkedAt: "2026-11-05T12:00:00.000Z", digest: "sha256:1e90", current: false, revision: "c15177a", created: "2026-11-06T01:02:32Z" },
    };
    const ui = { service: "stadeum-ui", image: "ghcr.io/stakwork/stadeum-ui:stable", latest: { problem: "could not reach ghcr.io: ENOTFOUND", triedAt: "2026-11-05T12:00:00.000Z" } };
    expect((await putStatus(call("PUT", status({ services: [strut, ui] })))).status).toBe(204);
    expect((await readStatus())?.status.services).toEqual([strut, ui]);
  });

  it("keep the last status, its snapshots and its window when the next leaves them out", async () => {
    const snapshots = [{ id: "abc", time: "2026-11-05T03:05:00Z", added: 10 }];
    await putStatus(call("PUT", status({ phase: "backing-up", detail: "taking the snapshot", snapshots, lastCycle: "2026-11-05" })));
    await putStatus(call("PUT", status({ phase: "idle" })));
    const read = await readStatus();
    expect(read?.status).toEqual({ phase: "idle", version: "abc1234", services: [], snapshots });
    expect((await settings()).lastCycle).toBe("2026-11-05");
  });

  it("refuse a status that is not one", async () => {
    expect((await putStatus(call("PUT", { phase: "dancing", version: "x", services: [] }))).status).toBe(400);
  });

  it("record what ops did, and hold back an image that was rolled back", async () => {
    const event = {
      kind: "update",
      outcome: "rolled-back",
      startedAt: "2026-11-05T03:01:00.000Z",
      endedAt: "2026-11-05T03:04:00.000Z",
      detail: "strut 2fe953a → 9a1b2c3 did not come up healthy, so the images it replaced were put back.",
      changes: [{ service: "strut", from: { id: "sha256:old", revision: "2fe953a" }, to: { id: "sha256:bad", revision: "9a1b2c3", digests: ["sha256:bad-index"] } }],
    };
    expect((await postHistory(call("POST", event))).status).toBe(201);
    // By its digest too: the registry names an image by that.
    expect((await settings()).failedImages).toEqual(["sha256:bad", "sha256:bad-index"]);
    const [entry] = await history(["update"]);
    expect(entry).toMatchObject({ outcome: "rolled-back", changes: event.changes });
    expect((await postHistory(call("POST", { ...event, kind: "party" }))).status).toBe(400);
  });
});
