import { describe, expect, it } from "vitest";

import { deps, FakeStack, FakeStrut, svc } from "./test/fakes.js";
import { checkGroup, takeOver, updateGroup, updateGroups } from "./update.js";

const opts = { force: false, failed: new Set<string>(), drainMinutes: 30 };

async function strutGroup(stack: FakeStack) {
  const group = updateGroups(stack.defs, stack.self).find((g) => g.name === "strut")!;
  return { group, checks: await checkGroup(stack, group.services) };
}

describe("update groups", () => {
  it("come from the labels, strut's first, leaving out ops and what is built here", () => {
    const stack = FakeStack.standard();
    stack.defs.push(svc("dev-thing", "dev:local", { group: "stadeum", built: true }));
    const groups = updateGroups(stack.defs, "ops");
    expect(groups.map((g) => [g.name, g.services.map((s) => s.name)])).toEqual([
      ["strut", ["strut-browser", "strut"]],
      ["stadeum", ["stadeum-ui"]],
    ]);
  });
});

describe("updating a group", () => {
  it("does nothing when the channel has what runs", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    const { group, checks } = await strutGroup(stack);
    expect(await updateGroup(deps(stack, strut).d, group, checks, opts)).toBeNull();
    expect(strut.calls).toEqual([]);
    expect(stack.calls).toEqual(["pull strut-browser strut"]);
  });

  it("drains strut, waits for idle, recreates the pair, checks health and records what moved", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    strut.busyPolls = 3;
    stack.publish("strut", "sha256:strut-2");
    stack.publish("strut-browser", "sha256:browser-2");
    const { group, checks } = await strutGroup(stack);
    const { d, phases } = deps(stack, strut);

    const event = await updateGroup(d, group, checks, opts);

    expect(event?.outcome).toBe("ok");
    expect(event?.changes).toEqual([
      { service: "strut-browser", from: { id: "sha256:strut-browser-1", revision: "strut-browser-1" }, to: { id: "sha256:browser-2", revision: "browser-2" } },
      { service: "strut", from: { id: "sha256:strut-1", revision: "strut-1" }, to: { id: "sha256:strut-2", revision: "strut-2" } },
    ]);
    expect(strut.calls[0]).toBe("drain 60 updating strut-browser strut-b → browser, strut strut-1 → strut-2");
    expect(strut.calls.at(-1)).toBe("lift");
    expect(phases.filter(([p]) => p === "draining")).toHaveLength(3);
    expect(stack.calls).toEqual(["pull strut-browser strut", "up strut-browser strut"]);
    expect(stack.containers.get("strut")).toBe("sha256:strut-2");
  });

  it("goes on after the drain wait runs out: what still runs resumes after the restart", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    strut.busyPolls = 10_000;
    stack.publish("strut", "sha256:strut-2");
    const { group, checks } = await strutGroup(stack);
    const { d, log } = deps(stack, strut);
    const event = await updateGroup(d, group, checks, { ...opts, drainMinutes: 1 });
    expect(event?.outcome).toBe("ok");
    expect(log.some((l) => /still busy after 1 min/.test(l))).toBe(true);
  });

  it("puts the images it replaced back when the new one is unhealthy", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    stack.publish("strut", "sha256:strut-bad");
    stack.unhealthy.add("sha256:strut-bad");
    const { group, checks } = await strutGroup(stack);

    const event = await updateGroup(deps(stack, strut).d, group, checks, opts);

    expect(event?.outcome).toBe("rolled-back");
    expect(event?.detail).toMatch(/did not come up healthy.*put back/);
    expect(stack.calls).toEqual([
      "pull strut-browser strut",
      "up strut-browser strut",
      "tag sha256:strut-1 ghcr.io/stakwork/strut:stable",
      "up strut-browser strut",
    ]);
    expect(stack.containers.get("strut")).toBe("sha256:strut-1");
    expect(strut.calls.at(-1)).toBe("lift");
  });

  it("rolls back when strut's API does not answer with the key after the restart", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    stack.publish("strut", "sha256:strut-2");
    const { group, checks } = await strutGroup(stack);
    const { d } = deps(stack, strut);
    let ups = 0;
    const up = stack.up.bind(stack);
    stack.up = async (s, o) => {
      await up(s, o);
      strut.healthy = ++ups > 1; // the new image answers without accepting the key; the old one is fine
    };
    const event = await updateGroup(d, group, checks, opts);
    expect(event?.outcome).toBe("rolled-back");
    expect(event?.detail).toMatch(/strut did not accept the key/);
  });

  it("says so when putting the old images back fails too", async () => {
    const stack = FakeStack.standard();
    stack.publish("strut", "sha256:strut-bad");
    stack.unhealthy.add("sha256:strut-bad");
    stack.unhealthy.add("sha256:strut-1");
    const { group, checks } = await strutGroup(stack);
    const event = await updateGroup(deps(stack, new FakeStrut()).d, group, checks, opts);
    expect(event?.outcome).toBe("failed");
  });

  it("holds back an image that failed before, and keeps the tag on what runs", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    stack.publish("strut", "sha256:strut-bad");
    const { group, checks } = await strutGroup(stack);
    const event = await updateGroup(deps(stack, strut).d, group, checks, { ...opts, failed: new Set(["sha256:strut-bad"]) });
    expect(event).toBeNull();
    expect(stack.tags.get("ghcr.io/stakwork/strut:stable")).toBe("sha256:strut-1");
    expect(strut.calls).toEqual([]);
  });

  it("tries it again when an admin says Update now", async () => {
    const stack = FakeStack.standard();
    stack.publish("strut", "sha256:strut-2");
    const { group, checks } = await strutGroup(stack);
    const event = await updateGroup(deps(stack, new FakeStrut()).d, group, checks, { ...opts, force: true, failed: new Set(["sha256:strut-2"]) });
    expect(event?.outcome).toBe("ok");
  });

  it("does not drain for a group without strut", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    stack.publish("stadeum-ui", "sha256:ui-2");
    const group = updateGroups(stack.defs, "ops").find((g) => g.name === "stadeum")!;
    const event = await updateGroup(deps(stack, strut).d, group, await checkGroup(stack, group.services), opts);
    expect(event?.outcome).toBe("ok");
    expect(strut.calls).toEqual([]);
  });

  it("goes on when strut does not take the drain", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    stack.publish("strut", "sha256:strut-2");
    const { group, checks } = await strutGroup(stack);
    strut.down = true;
    const up = stack.up.bind(stack);
    stack.up = async (s, o) => {
      await up(s, o);
      strut.down = false;
    };
    const event = await updateGroup(deps(stack, strut).d, group, checks, opts);
    expect(event?.outcome).toBe("ok");
    expect(strut.calls).toEqual([]);
  });
});

describe("ops taking over from itself", () => {
  it("recreates ops on the new image", async () => {
    const stack = FakeStack.standard();
    stack.publish("ops", "sha256:ops-2");
    await stack.pull(["ops"]);
    const event = await takeOver(deps(stack, new FakeStrut()).d, "sha256:ops-1");
    expect(event.outcome).toBe("ok");
    expect(stack.containers.get("ops")).toBe("sha256:ops-2");
  });

  it("puts the previous image back when the new one does not come up", async () => {
    const stack = FakeStack.standard();
    stack.publish("ops", "sha256:ops-bad");
    stack.unhealthy.add("sha256:ops-bad");
    await stack.pull(["ops"]);
    const event = await takeOver(deps(stack, new FakeStrut()).d, "sha256:ops-1");
    expect(event.outcome).toBe("rolled-back");
    expect(stack.containers.get("ops")).toBe("sha256:ops-1");
  });
});
