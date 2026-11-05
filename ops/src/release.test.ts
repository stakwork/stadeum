import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Files } from "./files.js";
import { applyRelease, planRelease } from "./release.js";
import { BOOTSTRAP, CADDYFILE, deps, FakeStack, FakeStrut, loop, releaseFiles, settings, standardServices, type FakeService } from "./test/fakes.js";

const ROUTE = `${CADDYFILE}{$SCHEME}://{$HOST}/release {\n\trespond "2"\n}\n`;

/** Release 1 with changes: services patched, other files replaced (null removes one). */
function release(patch: (s: Record<string, FakeService>) => void = () => {}, files: Record<string, string | null> = {}): Files {
  const services = standardServices();
  patch(services);
  const others: Record<string, string> = { "caddy/Caddyfile": CADDYFILE, "bootstrap/org-identity.mjs": BOOTSTRAP };
  for (const [p, c] of Object.entries(files)) {
    if (c === null) delete others[p];
    else others[p] = c;
  }
  return releaseFiles(services, others);
}

/** Release 2: a Caddy route and a setting stadeum-ui's new image needs, with new images for ops and stadeum-ui. */
const release2 = () =>
  release((s) => {
    s["stadeum-ui"]!.environment = { NEW_SETTING: "1" };
  }, { "caddy/Caddyfile": ROUTE });

/** The box as the ops that handed over leaves it: the release's images tagged on, the containers still on release 1. */
function handedOver(stack: FakeStack, files: Files) {
  stack.release("sha256:ops-2", files, "sha256:ui-2");
  stack.tags.set("ghcr.io/stakwork/stadeum-ops:stable", "sha256:ops-2");
  stack.tags.set("ghcr.io/stakwork/stadeum-ui:stable", "sha256:ui-2");
}

const apply = (stack: FakeStack, strut: FakeStrut, next: Files, confirmed: string[] = [], previous = "sha256:ops-1") =>
  applyRelease(deps(stack, strut).d, { next, previous, confirmed: new Set(confirmed), drainMinutes: 30 });

describe("planning a release", () => {
  it("says which stack files and image pins change, touching nothing", async () => {
    const stack = FakeStack.onFiles();
    const next = release((s) => {
      s.caddy!.image = "caddy:2.12.0-alpine";
    }, { "caddy/Caddyfile": ROUTE });
    const plan = await planRelease(stack, next, stack.releases.get("sha256:ops-1")!);
    expect(plan.files).toEqual(["caddy/Caddyfile", "stadeum.yml"]);
    expect(plan.images).toEqual([{ service: "caddy", from: "caddy:2.11.8-alpine", to: "caddy:2.12.0-alpine" }]);
    expect(plan.held).toEqual([]);
    expect(stack.read("caddy/Caddyfile")).toBe(CADDYFILE);
  });

  it("removes a file the running release has and the next does not", async () => {
    const stack = FakeStack.onFiles();
    const plan = await planRelease(stack, release(() => {}, { "bootstrap/org-identity.mjs": null }), stack.releases.get("sha256:ops-1")!);
    expect(plan.files).toEqual(["bootstrap/org-identity.mjs"]);
    expect(plan.write.get("bootstrap/org-identity.mjs")).toBeNull();
  });

  it("holds a change to a service that waits for an admin's word", async () => {
    const stack = FakeStack.onFiles();
    const plan = await planRelease(stack, release((s) => (s.neo4j!.image = "neo4j:5.26.40")), null);
    expect(plan.held).toEqual([{ service: "neo4j", from: "neo4j:5.26.32", to: "neo4j:5.26.40" }]);
  });

  it("fails on files compose cannot read with the box's", async () => {
    const stack = FakeStack.onFiles();
    await expect(planRelease(stack, new Map([["stadeum.yml", Buffer.from("services: [")]]), null)).rejects.toThrow();
  });
});

describe("applying a release", () => {
  it("drains strut, writes the files, recreates what they change, and leaves .env and local.yml alone", async () => {
    const stack = FakeStack.onFiles();
    const strut = new FakeStrut();
    const local = stack.read("local.yml");
    handedOver(stack, release2());

    const event = await apply(stack, strut, release2());

    expect(event?.outcome).toBe("ok");
    expect(event?.detail).toMatch(/^Updated release ops-1 → ops-2; caddy\/Caddyfile, stadeum\.yml changed; recreated caddy, stadeum-ui, ops/);
    expect(stack.read("caddy/Caddyfile")).toBe(ROUTE);
    expect(JSON.parse(stack.read("stadeum.yml")!).services["stadeum-ui"].environment).toEqual({ NEW_SETTING: "1" });
    expect(stack.read("local.yml")).toBe(local);
    // caddy for the Caddyfile it mounts, stadeum-ui for its image and config, ops for its image. Not bootstrap: a one-shot.
    expect(stack.calls).toEqual(["up --recreate caddy stadeum-ui ops"]);
    expect(strut.calls[0]).toMatch(/^drain 60 updating release ops-1 → ops-2/);
    expect(strut.calls.at(-1)).toBe("lift");
    expect(stack.containers.get("ops")).toBe("sha256:ops-2");
    expect(stack.containers.get("stadeum-ui")).toBe("sha256:ui-2");
    expect(event?.changes?.map((c) => [c.service, c.from?.id, c.to.id])).toEqual([
      ["stadeum-ui", "sha256:stadeum-ui-1", "sha256:ui-2"],
      ["ops", "sha256:ops-1", "sha256:ops-2"],
    ]);
  });

  it("does not drain when only stadeum-ui and ops move", async () => {
    const stack = FakeStack.onFiles();
    const strut = new FakeStrut();
    const same = stack.releases.get("sha256:ops-1")!;
    handedOver(stack, same);
    const event = await apply(stack, strut, same);
    expect(event?.outcome).toBe("ok");
    expect(stack.calls).toEqual(["up --recreate stadeum-ui ops"]);
    expect(strut.calls).toEqual([]);
  });

  it("pulls an image the files pin and the box lacks: every pin but Neo4j's moves with a release", async () => {
    const stack = FakeStack.onFiles();
    stack.registry.set("caddy:2.12.0-alpine", "sha256:caddy-2");
    const next = release((s) => (s.caddy!.image = "caddy:2.12.0-alpine"));
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next);
    expect(event?.outcome).toBe("ok");
    expect(stack.calls[0]).toBe("pull-images caddy:2.12.0-alpine");
    expect(stack.containers.get("caddy")).toBe("sha256:caddy-2");
  });

  it("puts the previous release's files and images back when it does not come up healthy", async () => {
    const stack = FakeStack.onFiles();
    const strut = new FakeStrut();
    const broken = release2();
    broken.set("caddy/Caddyfile", Buffer.from("{$SCHEME}://{$HOST} {\n\tBROKEN\n"));
    stack.brokenWhen = (s, dir) => s === "caddy" && readFileSync(join(dir, "caddy/Caddyfile"), "utf8").includes("BROKEN");
    handedOver(stack, broken);

    const event = await apply(stack, strut, broken);

    expect(event?.outcome).toBe("rolled-back");
    expect(event?.detail).toMatch(/stack files and images it replaced were put back\. container caddy is unhealthy/);
    expect(stack.read("caddy/Caddyfile")).toBe(CADDYFILE);
    expect(stack.read("stadeum.yml")).toBe(stack.releases.get("sha256:ops-1")!.get("stadeum.yml")!.toString());
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-1");
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ui:stable")).toBe("sha256:stadeum-ui-1");
    expect(stack.containers.get("ops")).toBe("sha256:ops-1");
    expect(stack.containers.get("stadeum-ui")).toBe("sha256:stadeum-ui-1");
    expect(stack.calls.filter((c) => c.startsWith("up"))).toEqual(["up --recreate caddy stadeum-ui ops", "up --recreate caddy stadeum-ui ops"]);
    expect(strut.calls.at(-1)).toBe("lift");
    // The images it tried are what the history holds back next time.
    expect(event?.changes?.map((c) => c.to.id)).toEqual(["sha256:ui-2", "sha256:ops-2"]);
  });

  it("removes a service the release adds when it rolls back, and brings back one it removed", async () => {
    const stack = FakeStack.onFiles();
    stack.registry.set("ghcr.io/stakwork/maple:1.0.0", "sha256:maple-1");
    const next = release((s) => {
      s.maple = { image: "ghcr.io/stakwork/maple:1.0.0", restart: "unless-stopped" };
      delete s.redis;
    });
    stack.unhealthy.add("sha256:maple-1");
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next);
    expect(event?.outcome).toBe("rolled-back");
    expect(stack.calls.filter((c) => c.startsWith("up"))).toEqual(["up --recreate stadeum-ui ops maple", "up --recreate stadeum-ui ops redis"]);
    expect(stack.containers.has("maple")).toBe(false);
    expect(stack.containers.get("redis")).toBe("sha256:redis-1");
  });

  it("rolls back to the box's own files when the ops before it carries none (older than releases)", async () => {
    const stack = FakeStack.onFiles();
    const before = stack.read("stadeum.yml");
    const next = release((s) => (s["stadeum-ui"]!.environment = { NEW_SETTING: "1" }));
    stack.unhealthy.add("sha256:ui-2");
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next, [], "sha256:ops-0");
    expect(event?.outcome).toBe("rolled-back");
    expect(stack.read("stadeum.yml")).toBe(before);
  });

  it("holds a Neo4j change it was not told an admin confirmed, and puts the tags back", async () => {
    const stack = FakeStack.onFiles();
    const next = release((s) => (s.neo4j!.image = "neo4j:5.26.40"));
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next);
    expect(event?.outcome).toBe("skipped");
    expect(event?.detail).toMatch(/is held: it upgrades neo4j from 5\.26\.32 to 5\.26\.40, which cannot be undone/);
    expect(stack.read("stadeum.yml")).toBe(stack.releases.get("sha256:ops-1")!.get("stadeum.yml")!.toString());
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-1");
    expect(stack.calls.filter((c) => c.startsWith("up"))).toEqual([]);
  });

  it("moves Neo4j when an admin confirmed that very version", async () => {
    const stack = FakeStack.onFiles();
    stack.registry.set("neo4j:5.26.40", "sha256:neo4j-2");
    const next = release((s) => (s.neo4j!.image = "neo4j:5.26.40"));
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next, ["neo4j:5.26.40"]);
    expect(event?.outcome).toBe("ok");
    expect(stack.containers.get("neo4j")).toBe("sha256:neo4j-2");
  });

  it("changes nothing when the box already has the release", async () => {
    const stack = FakeStack.onFiles();
    expect(await apply(stack, new FakeStrut(), stack.releases.get("sha256:ops-1")!)).toBeNull();
    expect(stack.calls).toEqual([]);
  });

  it("touches nothing when its files do not work with the box's", async () => {
    const stack = FakeStack.onFiles();
    const next = new Map([["stadeum.yml", Buffer.from("services: [")]]);
    handedOver(stack, next);
    const event = await apply(stack, new FakeStrut(), next);
    expect(event?.outcome).toBe("failed");
    expect(event?.detail).toMatch(/do not work with this box's .* Nothing changed\.$/);
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-1");
    expect(stack.read("stadeum.yml")).toBe(stack.releases.get("sha256:ops-1")!.get("stadeum.yml")!.toString());
  });
});

describe("the loop and a release", () => {
  const destination = { enabled: true, repository: "/backups/box", password: "pw", env: {} };
  const neo4jRelease = () => release((s) => (s.neo4j!.image = "neo4j:5.26.40"));
  const update = (id: string) => settings({ requests: [{ id, kind: "update", at: "2026-11-05T11:59:00Z" }] });

  it("a check says what the channel's release changes, and keeps the release's tags on what runs", async () => {
    const { ops, stack, stadeum } = loop();
    stack.release("sha256:ops-2", release2(), "sha256:ui-2");
    stadeum.current = settings({ requests: [{ id: "c1", kind: "check", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(stadeum.statuses.at(-1)!.release).toEqual({
      running: { id: "sha256:ops-1", revision: "ops-1" },
      available: { id: "sha256:ops-2", revision: "ops-2" },
      files: ["caddy/Caddyfile", "stadeum.yml"],
    });
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-1");
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ui:stable")).toBe("sha256:stadeum-ui-1");
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
  });

  it("holds a release that changes Neo4j: no files, no images, said once", async () => {
    const { ops, stack, stadeum } = loop();
    stack.release("sha256:ops-2", neo4jRelease(), "sha256:ui-2");
    stadeum.current = update("u1");
    await ops.tick();
    stadeum.current = update("u2");
    await ops.tick();
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-1");
    expect(stadeum.statuses.at(-1)!.release?.held).toEqual([{ service: "neo4j", from: "neo4j:5.26.32", to: "neo4j:5.26.40" }]);
    expect(stadeum.events.map((e) => [e.outcome, e.detail])).toEqual([
      ["skipped", "A release is waiting: it upgrades neo4j from 5.26.32 to 5.26.40, which cannot be undone. Nothing moves until an admin confirms it here; ops backs up first."],
    ]);
  });

  it("Upgrade Neo4j: a fresh backup, then the hand-over with the confirmation", async () => {
    const { ops, stack, stadeum, restic } = loop();
    stack.release("sha256:ops-2", neo4jRelease(), "sha256:ui-2");
    stadeum.current = settings({ backups: { ...destination, enabled: false }, requests: [{ id: "n1", kind: "confirm", target: "neo4j:5.26.40", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(restic.calls).toEqual(["open", expect.stringMatching(/^backup stadeum/), "forget"]);
    expect(stadeum.events.map((e) => [e.kind, e.outcome])).toEqual([["backup", "ok"]]);
    expect(stack.calls.at(-1)).toBe("spawn hand-over sha256:ops-1 --confirm neo4j:5.26.40");
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:stable")).toBe("sha256:ops-2");
  });

  it("does not upgrade Neo4j without a backup destination, or when the backup fails", async () => {
    const { ops, stack, stadeum, restic } = loop();
    stack.release("sha256:ops-2", neo4jRelease(), "sha256:ui-2");
    stadeum.current = settings({ requests: [{ id: "n1", kind: "confirm", target: "neo4j:5.26.40", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    restic.failBackup = true;
    stadeum.current = settings({ backups: destination, requests: [{ id: "n2", kind: "confirm", target: "neo4j:5.26.40", at: "2026-11-05T11:59:30Z" }] });
    await ops.tick();
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
    expect(stadeum.events.map((e) => [e.kind, e.outcome, e.detail.slice(0, 40)])).toEqual([
      ["update", "failed", "Not upgraded: it upgrades neo4j from 5.2"],
      ["backup", "failed", "The snapshot failed: bucket not found"],
      ["update", "failed", "Not upgraded: the backup before it faile"],
    ]);
  });

  it("asks again when the release moved on to another Neo4j than the one confirmed", async () => {
    const { ops, stack, stadeum, restic } = loop();
    stack.release("sha256:ops-3", release((s) => (s.neo4j!.image = "neo4j:2026.01.0")), "sha256:ui-3");
    stadeum.current = settings({ backups: destination, requests: [{ id: "n1", kind: "confirm", target: "neo4j:5.26.40", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(restic.calls).toEqual([]);
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
    expect(stadeum.events.at(-1)?.detail).toMatch(/now upgrades neo4j from 5\.26\.32 to 2026\.01\.0, which is not what was confirmed/);
  });

  it("holds back a release that failed before at night, and tries it again on Update now", async () => {
    const { ops, stack, stadeum, at } = loop("2026-11-05T03:20:00Z");
    stack.release("sha256:ops-2", release2(), "sha256:ui-2");
    stadeum.current = settings({ failedImages: ["sha256:ops-2", "sha256:ui-2"] });
    await ops.tick();
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
    at("2026-11-05T12:00:00Z");
    stadeum.current = settings({ failedImages: ["sha256:ops-2", "sha256:ui-2"], requests: [{ id: "u1", kind: "update", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(stack.calls.at(-1)).toBe("spawn hand-over sha256:ops-1");
  });

  it("says so when the channel's ops carries no stack files", async () => {
    const { ops, stack, stadeum } = loop();
    stack.publish("ops", "sha256:ops-old");
    stadeum.current = update("u1");
    await ops.tick();
    expect(stack.calls.some((c) => c.startsWith("spawn"))).toBe(false);
    expect(stadeum.statuses.at(-1)!.release?.problem).toBe("the channel's ops image (ops-old) carries no stack files");
  });
});
