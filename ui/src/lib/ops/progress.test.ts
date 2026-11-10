import { describe, expect, it } from "vitest";

import type { OpsStatus, ServiceImage } from "./contract";
import { found, updatesNow, viewRequest, withStep, type AskedRow, type EventRow, type Report } from "./progress";

const now = new Date("2026-11-10T12:05:00Z");
const t = (hhmmss: string) => new Date(`2026-11-10T${hhmmss}Z`);

const strut = (latest: ServiceImage["latest"]): ServiceImage => ({ service: "strut", image: "ghcr.io/stakwork/strut:stable", group: "strut", latest });
const ui = (latest: ServiceImage["latest"]): ServiceImage => ({ service: "stadeum-ui", image: "ghcr.io/stakwork/stadeum-ui:stable", group: "stadeum", release: true, latest });
const current = { checkedAt: "2026-11-10T12:04:30Z", digest: "sha256:aaa", current: true };

const report = (patch: Partial<OpsStatus> = {}, at = "12:04:50"): Report => ({
  status: { phase: "idle", version: "ops-1", services: [strut(current), ui(current)], checkedAt: "2026-11-10T12:04:30Z", ...patch },
  reportedAt: t(at),
});
const update = (patch: Partial<AskedRow> = {}): AskedRow => ({ id: "u1", kind: "update", createdAt: t("12:03:00"), doneAt: null, ...patch });
const check = (patch: Partial<AskedRow> = {}): AskedRow => ({ id: "c1", kind: "check", createdAt: t("12:04:00"), doneAt: null, ...patch });
const event = (outcome: EventRow["outcome"], detail: string, at: string, kind: EventRow["kind"] = "update"): EventRow => ({ kind, outcome, detail, createdAt: t(at) });

describe("an Update now, as the Updates page says it", () => {
  it("waits for ops to take it up, and says why when ops is busy or silent", () => {
    expect(viewRequest(update(), report(), [], now)).toEqual({
      id: "u1",
      kind: "update",
      askedAt: "2026-11-10T12:03:00.000Z",
      state: "waiting",
      note: "ops takes it up within half a minute.",
    });
    expect(viewRequest(update(), report({ phase: "backing-up", detail: "taking the snapshot" }), [], now)).toMatchObject({
      state: "waiting",
      note: "ops is backing up first, and takes this up after.",
    });
    expect(viewRequest(update(), report({}, "11:58:00"), [], now)).toMatchObject({ state: "waiting", note: "ops is not answering: last heard from 7 minutes ago." });
    expect(viewRequest(update(), null, [], now)).toMatchObject({ state: "waiting", note: "ops has not reported yet. Is its container running?" });
  });

  it("is worked on while ops reports a phase of it, with ops's words and when it said them", () => {
    for (const phase of ["checking", "draining", "updating", "rolling-back"] as const) {
      expect(viewRequest(update(), report({ phase, detail: "strut 5c3fb86 → d306035" }, "12:04:10"), [], now)).toMatchObject({
        state: "working",
        step: { phase, detail: "strut 5c3fb86 → d306035", at: "2026-11-10T12:04:10.000Z" },
      });
    }
  });

  it("says what it updated, to which commit, once ops is done", () => {
    const done = update({ doneAt: t("12:04:55") });
    const events = [event("ok", "Updated strut 5c3fb86 → d306035 in 1 min.", "12:04:52")];
    expect(viewRequest(done, report(), events, now)).toMatchObject({
      state: "ended",
      endedAt: "2026-11-10T12:04:55.000Z",
      tone: "ok",
      label: "Updated",
      notes: ["Updated strut 5c3fb86 → d306035 in 1 min."],
    });
  });

  it("says a rollback or a failure, and why", () => {
    const done = update({ doneAt: t("12:04:55") });
    expect(viewRequest(done, report(), [event("rolled-back", "strut 5c3fb86 → 9a1b2c3 did not come up healthy, so the images it replaced were put back.", "12:04:50")], now)).toMatchObject({
      tone: "attention",
      label: "Rolled back",
      notes: ["strut 5c3fb86 → 9a1b2c3 did not come up healthy, so the images it replaced were put back."],
    });
    // Several: each with its outcome.
    const two = [event("ok", "Updated strut 5c3fb86 → d306035 in 1 min.", "12:04:20"), event("failed", "Release a → b did not come up healthy, and …", "12:04:50")];
    expect(viewRequest(done, report(), two, now)).toMatchObject({
      tone: "attention",
      label: "Update failed",
      notes: ["Done: Updated strut 5c3fb86 → d306035 in 1 min.", "Failed: Release a → b did not come up healthy, and …"],
    });
  });

  it("says there was nothing to update, from what the check found", () => {
    expect(viewRequest(update({ doneAt: t("12:04:55") }), report(), [], now)).toMatchObject({
      state: "ended",
      tone: "ok",
      label: "Nothing to update",
      notes: ["Everything is current: strut and stadeum-ui run what their channels name."],
    });
    // A check that could not pull says so.
    expect(viewRequest(update({ doneAt: t("12:04:55") }), report({ detail: "Could not check strut: pull access denied" }), [], now)).toMatchObject({
      tone: "attention",
      label: "Nothing updated",
      notes: ["Could not check strut: pull access denied."],
    });
  });

  it("counts only what was recorded since it was asked", () => {
    const older = event("ok", "Updated strut 1111111 → 5c3fb86 in 1 min.", "03:10:00");
    expect(viewRequest(update({ doneAt: t("12:04:55") }), report(), [older], now)).toMatchObject({ label: "Nothing to update" });
  });

  it("goes on while the release it handed over goes in, and ends with its outcome", () => {
    const done = update({ doneAt: t("12:04:00") });
    const strutDone = event("ok", "Updated strut 5c3fb86 → d306035 in 1 min.", "12:03:50");
    // Marked done with the hand-over; the ops it brings reports from there.
    expect(viewRequest(done, report({ phase: "updating", detail: "Handing release 1a2b3c4 → 5d6e7f8 to the ops it brings" }, "12:04:00"), [strutDone], now)).toMatchObject({
      state: "working",
      step: { phase: "updating", detail: "Handing release 1a2b3c4 → 5d6e7f8 to the ops it brings" },
    });
    expect(viewRequest(done, report({ phase: "draining", detail: "updating release …: waiting on 1 run and 0 chats" }), [strutDone], now)).toMatchObject({ state: "working" });
    // The release's outcome is in: it has ended, whatever the status says a moment longer.
    const releaseDone = event("ok", "Updated release 1a2b3c4 → 5d6e7f8; stadeum.yml changed; recreated stadeum-ui, ops, in 40 s.", "12:04:45");
    expect(viewRequest(done, report({ phase: "updating" }), [strutDone, releaseDone], now)).toMatchObject({
      state: "ended",
      endedAt: "2026-11-10T12:04:45.000Z",
      label: "Updated",
      notes: [`Done: ${strutDone.detail}`, `Done: ${releaseDone.detail}`],
    });
    // A done request does not take a later check of ops's for its own.
    expect(viewRequest(done, report({ phase: "checking" }), [strutDone], now)).toMatchObject({ state: "ended" });
  });
});

describe("a Check now, as the Updates page says it", () => {
  it("waits, is worked on while ops checks, and says what it found when", () => {
    expect(viewRequest(check(), report({ phase: "updating" }), [], now)).toMatchObject({ state: "waiting", note: "ops is updating first, and takes this up after." });
    expect(viewRequest(check(), report({ phase: "checking", detail: "Asking the registries what the channels name" }), [], now)).toMatchObject({ state: "working" });
    expect(viewRequest(check({ doneAt: t("12:04:35") }), report(), [], now)).toEqual({
      id: "c1",
      kind: "check",
      askedAt: "2026-11-10T12:04:00.000Z",
      state: "ended",
      // When ops asked the registries.
      endedAt: "2026-11-10T12:04:30.000Z",
      tone: "ok",
      label: "Checked",
      notes: ["Everything is current: strut and stadeum-ui run what their channels name."],
    });
  });

  it("says a check that never asked the registries", () => {
    expect(viewRequest(check({ doneAt: t("12:04:35") }), report({ checkedAt: "2026-11-10T11:55:00Z" }), [], now)).toMatchObject({ tone: "attention", label: "Not checked" });
  });
});

describe("what a check found", () => {
  const status = (services: ServiceImage[], release?: OpsStatus["release"]): OpsStatus => ({ phase: "idle", version: "x", services, ...(release ? { release } : {}) });

  it("names what is out, with its commit and age, and what brings it in", () => {
    const out = strut({ checkedAt: "2026-11-10T12:04:30Z", digest: "sha256:bbb", current: false, revision: "d306035abc", created: "2026-11-10T10:00:00Z" });
    expect(found(status([out, ui(current)]), now)).toEqual({ tone: "pending", note: "strut: d306035 is out, built 2 hours ago. Update now, or the next window, brings it in." });
  });

  it("names a release once, and one waiting for an admin as such", () => {
    const newer = { checkedAt: "2026-11-10T12:04:30Z", digest: "sha256:ccc", current: false, revision: "5d6e7f8" };
    const release = { running: { id: "sha256:ops-1", revision: "1a2b3c4" }, available: { id: "sha256:ops-2", revision: "5d6e7f8aaa" } };
    expect(found(status([strut(current), ui(newer)], release), now).note).toBe("Release 5d6e7f8 is out. Update now, or the next window, brings it in.");
    const held = { ...release, held: [{ service: "neo4j", from: "neo4j:5.26.32", to: "neo4j:5.26.40" }] };
    expect(found(status([strut(current), ui(newer)], held), now)).toEqual({ tone: "pending", note: "Release 5d6e7f8 is out, and waits for you above." });
  });

  it("says what could not be checked", () => {
    expect(found(status([strut({ problem: "could not reach ghcr.io: ENOTFOUND", triedAt: "2026-11-10T12:04:30Z" })]), now)).toEqual({
      tone: "attention",
      note: "Could not check strut: could not reach ghcr.io: ENOTFOUND.",
    });
  });

  it("leaves out what is built on this box", () => {
    expect(found(status([strut(current), { service: "stadeum-ui", image: "stadeum-ui:dev", group: "stadeum", built: true }]), now).note).toBe(
      "Everything is current: strut runs what its channel names.",
    );
  });
});

describe("the page's live part", () => {
  it("shows the latest of each, the open one first, and an ended one for a while only", () => {
    const live = updatesNow({
      now,
      report: report(),
      open: ["confirm", "update"],
      latest: [check({ doneAt: t("12:04:35") }), update()],
      lastDone: "c1",
      events: [],
    });
    // The check is newer, but the update is still open.
    expect(live.requests.map((r) => [r.kind, r.state])).toEqual([
      ["update", "waiting"],
      ["check", "ended"],
    ]);
    // The last one done says how things stand: the one before is in History.
    const both = updatesNow({ now, report: report(), open: [], latest: [check({ doneAt: t("12:04:35") }), update({ doneAt: t("12:03:30") })], lastDone: "c1", events: [] });
    expect(both.requests.map((r) => r.kind)).toEqual(["check"]);
    // An earlier update, done after the check, keeps the check's outcome off the page.
    expect(updatesNow({ now, report: report(), open: ["update"], latest: [check({ doneAt: t("12:04:35") }), update({ id: "u2", createdAt: t("12:04:50") })], lastDone: "u0", events: [] }).requests.map((r) => r.id)).toEqual(["u2"]);
    const reopened = updatesNow({ now, report: report(), open: ["check"], latest: [check(), update({ doneAt: t("12:03:30") })], lastDone: "u1", events: [] });
    expect(reopened.requests.map((r) => [r.kind, r.state])).toEqual([
      ["check", "waiting"],
      ["update", "ended"],
    ]);
    // The other open requests are for the line under ops's state.
    expect(live.asked).toEqual(["confirm"]);
    expect(live.heard).toEqual({ phase: "idle", at: "2026-11-10T12:04:50.000Z" });
    expect(live.at).toBe(now.toISOString());

    const later = updatesNow({ now: new Date("2026-11-10T12:25:00Z"), report: report(), open: [], latest: [check({ doneAt: t("12:04:35") })], lastDone: "c1", events: [] });
    expect(later.requests).toEqual([]);
  });

  it("keeps each step once, with when it began", () => {
    const a = { phase: "draining" as const, detail: "waiting on 2 runs", at: "12:03:40" };
    let steps = withStep([], { phase: "checking", at: "12:03:20" });
    steps = withStep(steps, a);
    expect(withStep(steps, { ...a, at: "12:03:45" })).toBe(steps);
    steps = withStep(steps, { ...a, detail: "waiting on 1 run", at: "12:03:50" });
    steps = withStep(steps, { phase: "updating", detail: "strut 5c3fb86 → d306035", at: "12:04:10" });
    expect(steps).toEqual([
      { phase: "checking", at: "12:03:20" },
      { phase: "draining", detail: "waiting on 1 run", at: "12:03:40" },
      { phase: "updating", detail: "strut 5c3fb86 → d306035", at: "12:04:10" },
    ]);
  });
});
