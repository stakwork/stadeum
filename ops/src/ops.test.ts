import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Ops } from "./ops.js";
import { FakeRestic, FakeStack, FakeStadeum, FakeStrut, settings } from "./test/fakes.js";

function setup(now = "2026-11-05T12:00:00Z") {
  const stack = FakeStack.standard();
  const strut = new FakeStrut();
  const stadeum = new FakeStadeum();
  const restic = new FakeRestic();
  let t = new Date(now).getTime();
  const log: string[] = [];
  const ops = new Ops({
    stack,
    strut,
    stadeum,
    restic: () => restic,
    log: (m) => log.push(m),
    now: () => new Date(t),
    sleep: async (ms) => {
      t += ms;
    },
    version: "abc1234",
    host: "stadeum",
    paths: { volumes: "/volumes", envDir: join(mkdtempSync(join(tmpdir(), "ops-loop-")), "env") },
  });
  return { ops, stack, strut, stadeum, restic, log, at: (iso: string) => (t = new Date(iso).getTime()) };
}

const destination = { enabled: true, repository: "/backups/box", password: "pw", env: {} };

describe("the loop", () => {
  it("reports what runs on every service, and stays idle outside the window", async () => {
    const { ops, stadeum, stack } = setup();
    await ops.tick();
    const last = stadeum.statuses.at(-1)!;
    expect(last.phase).toBe("idle");
    expect(last.version).toBe("abc1234");
    expect(last.services.find((s) => s.service === "strut")).toEqual({
      service: "strut",
      image: "ghcr.io/stakwork/strut:stable",
      group: "strut",
      running: { id: "sha256:strut-1", revision: "strut-1" },
    });
    expect(last.services.find((s) => s.service === "neo4j")?.group).toBeUndefined();
    expect(stack.calls).toEqual([]);
  });

  it("checks when asked, says what is new, and marks the request done", async () => {
    const { ops, stadeum, stack } = setup();
    stack.publish("strut", "sha256:strut-2");
    stadeum.current = settings({ requests: [{ id: "r1", kind: "check", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    const last = stadeum.statuses.at(-1)!;
    expect(last.done).toEqual(["r1"]);
    expect(last.checkedAt).toBe("2026-11-05T12:00:00.000Z");
    expect(last.services.find((s) => s.service === "strut")?.available).toEqual({ id: "sha256:strut-2", revision: "strut-2" });
    expect(stack.containers.get("strut")).toBe("sha256:strut-1");

    // The same request, still listed until stadeum-ui has it, is not run twice.
    stack.calls = [];
    await ops.tick();
    expect(stack.calls).toEqual([]);
  });

  it("keeps the tag on what runs when the channel's image failed before", async () => {
    const { ops, stadeum, stack } = setup();
    stack.publish("strut", "sha256:strut-bad");
    stadeum.current = settings({ failedImages: ["sha256:strut-bad"], requests: [{ id: "r4", kind: "check", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(stack.tags.get("ghcr.io/stakwork/strut:stable")).toBe("sha256:strut-1");
    // The page still says what the channel has, and that it is held back.
    expect(stadeum.statuses.at(-1)!.services.find((s) => s.service === "strut")?.available?.id).toBe("sha256:strut-bad");
  });

  it("updates when asked, even outside the window, and hands over to its own new image last", async () => {
    const { ops, stadeum, stack } = setup();
    stack.publish("strut", "sha256:strut-2");
    stack.publish("ops", "sha256:ops-2");
    stadeum.current = settings({ requests: [{ id: "r2", kind: "update", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(stack.containers.get("strut")).toBe("sha256:strut-2");
    expect(stadeum.events.map((e) => [e.kind, e.outcome])).toEqual([["update", "ok"]]);
    expect(stack.calls.at(-1)).toBe("spawn hand-over sha256:ops-1");
    // The status saying it is done went out before the hand-over.
    expect(stadeum.statuses.at(-1)!.done).toEqual(["r2"]);
  });

  it("runs the daily pass once in the window: the backup, then the updates", async () => {
    const { ops, stadeum, stack, restic, at } = setup("2026-11-05T03:20:00Z");
    stack.publish("strut", "sha256:strut-2");
    stadeum.current = settings({ backups: destination });
    await ops.tick();
    expect(restic.calls).toEqual(["open", expect.stringMatching(/^backup stadeum \/volumes \/.+\/env$/), "forget"]);
    expect(stadeum.events.map((e) => [e.kind, e.outcome])).toEqual([
      ["backup", "ok"],
      ["update", "ok"],
    ]);
    const last = stadeum.statuses.at(-1)!;
    expect(last.lastCycle).toBe("2026-11-05");
    expect(last.snapshots?.[0]?.id).toBe("snap1aaaaaaaa");

    // Later in the same window: nothing again.
    restic.calls = [];
    at("2026-11-05T04:30:00Z");
    await ops.tick();
    expect(restic.calls).toEqual([]);
  });

  it("does not run a pass stadeum-ui says already ran in this window (ops restarted)", async () => {
    const { ops, stadeum, restic } = setup("2026-11-05T03:20:00Z");
    stadeum.current = settings({ backups: destination, lastCycle: "2026-11-05" });
    await ops.tick();
    expect(restic.calls).toEqual([]);
  });

  it("holds the updates back when tonight's backup failed", async () => {
    const { ops, stadeum, stack, restic } = setup("2026-11-05T03:20:00Z");
    stack.publish("strut", "sha256:strut-2");
    restic.failBackup = true;
    stadeum.current = settings({ backups: destination });
    await ops.tick();
    expect(stadeum.events.map((e) => [e.kind, e.outcome, e.detail])).toEqual([
      ["backup", "failed", "The snapshot failed: bucket not found"],
      ["update", "skipped", "Updates held back: tonight's backup failed."],
    ]);
    expect(stack.containers.get("strut")).toBe("sha256:strut-1");
  });

  it("leaves updates alone when they are off", async () => {
    const { ops, stadeum, stack } = setup("2026-11-05T03:20:00Z");
    stack.publish("strut", "sha256:strut-2");
    stadeum.current = settings({ updates: { enabled: false } });
    await ops.tick();
    expect(stack.containers.get("strut")).toBe("sha256:strut-1");
    expect(stadeum.statuses.at(-1)!.lastCycle).toBe("2026-11-05");
  });

  it("keeps what it did until stadeum-ui answers again", async () => {
    const { ops, stadeum, stack } = setup();
    stack.publish("stadeum-ui", "sha256:ui-2");
    stadeum.current = settings({ requests: [{ id: "r3", kind: "update", at: "2026-11-05T11:59:00Z" }] });
    // stadeum-ui goes away while it is recreated, and the history waits.
    const up = stack.up.bind(stack);
    stack.up = async (s, o) => {
      stadeum.down = true;
      await up(s, o);
    };
    await ops.tick();
    expect(stadeum.events).toEqual([]);
    stadeum.down = false;
    stadeum.current = settings();
    await ops.tick();
    expect(stadeum.events.map((e) => e.outcome)).toEqual(["ok"]);
    expect(stadeum.statuses.at(-1)!.done).toEqual(["r3"]);
  });

  it("works from the settings it last had while stadeum-ui is down", async () => {
    const { ops, stadeum, restic, at } = setup("2026-11-04T12:00:00Z");
    stadeum.current = settings({ backups: destination });
    await ops.tick();
    stadeum.down = true;
    at("2026-11-05T03:20:00Z");
    await ops.tick();
    expect(restic.calls.some((c) => c.startsWith("backup stadeum /volumes"))).toBe(true);
  });
});
