import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSize } from "./compose.js";
import type { Files } from "./files.js";
import { describePruned, Images, repoOf } from "./images.js";
import { applyRelease } from "./release.js";
import { CADDYFILE, BOOTSTRAP, deps, FakeStack, FakeStrut, loop, releaseFiles, settings, standardServices, type FakeService } from "./test/fakes.js";

const update = (id: string) => settings({ requests: [{ id, kind: "update", at: "2026-11-05T11:59:00Z" }] });

/** strut and strut-browser's channel moves to `n`. */
function strutRelease(stack: FakeStack, n: number) {
  stack.publish("strut", `sha256:strut-${n}`);
  stack.publish("strut-browser", `sha256:strut-browser-${n}`);
}

describe("old images after strut's updates", () => {
  it("keeps what runs and the one before it, and removes the one before that, saying so in the update's line", async () => {
    const { ops, stack, stadeum } = loop();
    strutRelease(stack, 2);
    stadeum.current = update("u1");
    await ops.tick();
    expect(stack.tags.get("ghcr.io/stakwork/strut:ops-previous")).toBe("sha256:strut-1");
    expect(stadeum.events.at(-1)!.detail).not.toMatch(/Removed/);

    strutRelease(stack, 3);
    stadeum.current = update("u2");
    await ops.tick();
    expect(stack.containers.get("strut")).toBe("sha256:strut-3");
    expect(stack.tags.get("ghcr.io/stakwork/strut:ops-previous")).toBe("sha256:strut-2");
    expect(stack.present.has("sha256:strut-1")).toBe(false);
    expect(stack.present.has("sha256:strut-browser-1")).toBe(false);
    expect(stack.present.has("sha256:strut-2")).toBe(true);
    expect(stadeum.events.at(-1)!.detail).toMatch(/ Removed 2 old images \(strut-browser strut-b, strut strut-1\): 2\.0 GB freed\.$/);
  });

  it("keeps a held-back image while the channel names it, and removes it once the channel moves on", async () => {
    const { ops, stack, stadeum } = loop();
    strutRelease(stack, 2);
    stadeum.current = update("u1");
    await ops.tick();
    stack.publish("strut", "sha256:strut-bad");
    stack.unhealthy.add("sha256:strut-bad");
    stadeum.current = update("u2");
    await ops.tick();
    expect(stadeum.events.at(-1)!.outcome).toBe("rolled-back");
    // Named, so tonight's pull finds it here and holds it back again without a download.
    expect(stack.tags.get("ghcr.io/stakwork/strut:ops-channel")).toBe("sha256:strut-bad");
    expect(stack.present.has("sha256:strut-bad")).toBe(true);
    expect(stack.present.has("sha256:strut-1")).toBe(true);

    stack.publish("strut", "sha256:strut-4");
    stadeum.current = settings({ failedImages: ["sha256:strut-bad"], requests: [{ id: "u3", kind: "update", at: "2026-11-05T11:59:30Z" }] });
    await ops.tick();
    expect(stack.containers.get("strut")).toBe("sha256:strut-4");
    expect(stack.present.has("sha256:strut-bad")).toBe(false);
    expect(stack.present.has("sha256:strut-1")).toBe(false);
    expect(stack.tags.get("ghcr.io/stakwork/strut:ops-previous")).toBe("sha256:strut-2");
  });

  it("removes a channel image the box never ran once the channel has a newer one", async () => {
    const { ops, stack, stadeum } = loop();
    stack.publish("strut", "sha256:strut-2");
    // A pull that moved nothing (an update held back) leaves the channel's image here.
    await ops.check();
    stack.publish("strut", "sha256:strut-3");
    stadeum.current = update("u1");
    await ops.tick();
    expect(stack.containers.get("strut")).toBe("sha256:strut-3");
    expect(stack.present.has("sha256:strut-2")).toBe(false);
    expect(stadeum.events.at(-1)!.detail).toMatch(/Removed 1 old image \(strut strut-2\)/);
  });

  it("leaves an image that also has a name ops does not own, or that another container uses", async () => {
    const { ops, stack, stadeum } = loop();
    stack.tags.set("ghcr.io/stakwork/strut:2fe953a", "sha256:strut-1");
    stack.otherContainers.add("sha256:strut-browser-1");
    strutRelease(stack, 2);
    stadeum.current = update("u1");
    await ops.tick();
    strutRelease(stack, 3);
    stadeum.current = update("u2");
    await ops.tick();
    expect(stack.present.has("sha256:strut-1")).toBe(true);
    expect(stack.tags.get("ghcr.io/stakwork/strut:2fe953a")).toBe("sha256:strut-1");
    expect(stack.present.has("sha256:strut-browser-1")).toBe(true);
    expect(stadeum.events.at(-1)!.detail).not.toMatch(/Removed/);
  });

  it("never touches an image it never named", async () => {
    const { ops, stack, stadeum } = loop();
    stack.tags.set("postgres:15-alpine", "sha256:postgres");
    stack.present.add("sha256:postgres");
    stack.present.add("sha256:someone-elses-dangling");
    for (const n of [2, 3, 4]) {
      strutRelease(stack, n);
      stadeum.current = update(`u${n}`);
      await ops.tick();
    }
    expect(stack.present.has("sha256:postgres")).toBe(true);
    expect(stack.present.has("sha256:someone-elses-dangling")).toBe(true);
  });

  it("removes a superseded channel image in a pass that moves nothing else, on a line of its own", async () => {
    const { ops, stack, stadeum } = loop();
    stack.release("sha256:ops-2", stack.releases.get("sha256:ops-1")!, "sha256:ui-2");
    stadeum.current = settings({ requests: [{ id: "c1", kind: "check", at: "2026-11-05T11:59:00Z" }] });
    await ops.tick();
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:ops-channel")).toBe("sha256:ops-2");
    // The channel moves on before the box applied it, and the new one is held: nothing moves.
    stack.release("sha256:ops-3", stack.releases.get("sha256:ops-1")!, "sha256:ui-3");
    stadeum.current = settings({ failedImages: ["sha256:ops-3", "sha256:ui-3"], requests: [{ id: "u1", kind: "update", at: "2026-11-05T11:59:30Z" }] });
    await ops.tick();
    expect(stack.present.has("sha256:ops-2")).toBe(false);
    expect(stack.present.has("sha256:ui-2")).toBe(false);
    expect(stack.present.has("sha256:ops-3")).toBe(true);
    expect(stadeum.events.map((e) => [e.outcome, e.detail])).toEqual([["ok", "Removed 2 old images (stadeum-ui ui-2, ops ops-2): 2.0 GB freed."]]);
  });

  it("removes nothing after a pass that moved nothing", async () => {
    const { ops, stack, stadeum } = loop();
    stadeum.current = update("u1");
    await ops.tick();
    expect(stack.housekeeping.filter((h) => !h.startsWith("name"))).toEqual([]);
  });
});

/** Release 1 changed: services patched. */
function release(patch: (s: Record<string, FakeService>) => void = () => {}, caddyfile = CADDYFILE): Files {
  const services = standardServices();
  patch(services);
  return releaseFiles(services, { "caddy/Caddyfile": caddyfile, "bootstrap/org-identity.mjs": BOOTSTRAP });
}

/** The ops that handed release `n` over: its images on the channel, tagged on, and named `ops-channel` by its check. */
function handedOver(stack: FakeStack, n: number, files: Files) {
  stack.release(`sha256:ops-${n}`, files, `sha256:ui-${n}`);
  for (const [ref, id] of [["ghcr.io/stakwork/stadeum-ops", `sha256:ops-${n}`], ["ghcr.io/stakwork/stadeum-ui", `sha256:ui-${n}`]] as const) {
    stack.tags.set(`${ref}:stable`, id);
    stack.tags.set(`${ref}:ops-channel`, id);
    stack.present.add(id);
  }
}

const apply = (stack: FakeStack, images: Images, next: Files, previous: string) =>
  applyRelease(deps(stack, new FakeStrut()).d, { next, previous, confirmed: new Set(), drainMinutes: 30, images });

describe("old images after a release", () => {
  it("keeps the release before, removes the one before that, and an old pin goes in its turn", async () => {
    const stack = FakeStack.onFiles();
    const images = new Images(stack, () => {});
    stack.registry.set("caddy:2.12.0-alpine", "sha256:caddy-2");
    stack.registry.set("caddy:2.13.0-alpine", "sha256:caddy-3");

    const r2 = release((s) => (s.caddy!.image = "caddy:2.12.0-alpine"));
    handedOver(stack, 2, r2);
    expect((await apply(stack, images, r2, "sha256:ops-1"))?.outcome).toBe("ok");
    expect(stack.tags.get("ghcr.io/stakwork/stadeum-ops:ops-previous")).toBe("sha256:ops-1");
    expect(stack.tags.get("caddy:ops-previous")).toBe("sha256:caddy-1");
    // The stack no longer names Caddy's old pin: only ops's name keeps it.
    expect(stack.tags.has("caddy:2.11.8-alpine")).toBe(false);

    const r3 = release((s) => (s.caddy!.image = "caddy:2.13.0-alpine"));
    handedOver(stack, 3, r3);
    const event = await apply(stack, images, r3, "sha256:ops-2");
    expect(event?.outcome).toBe("ok");
    for (const gone of ["sha256:ops-1", "sha256:ui-1", "sha256:caddy-1"]) expect(stack.present.has(gone)).toBe(false);
    for (const kept of ["sha256:ops-2", "sha256:ui-2", "sha256:caddy-2", "sha256:ops-3", "sha256:caddy-3"]) expect(stack.present.has(kept)).toBe(true);
    expect(stack.tags.get("caddy:ops-previous")).toBe("sha256:caddy-2");
    expect(event?.detail).toMatch(/Removed 3 old images \(caddy caddy-1, stadeum-ui stadeum, ops ops-1\): 3\.0 GB freed\.$/);
  });

  it("leaves an old pin's name, and its image, when another project on the machine runs it", async () => {
    const stack = FakeStack.onFiles();
    const images = new Images(stack, () => {});
    stack.otherContainers.add("sha256:caddy-1");
    stack.registry.set("caddy:2.12.0-alpine", "sha256:caddy-2");
    stack.registry.set("caddy:2.13.0-alpine", "sha256:caddy-3");
    const r2 = release((s) => (s.caddy!.image = "caddy:2.12.0-alpine"));
    handedOver(stack, 2, r2);
    await apply(stack, images, r2, "sha256:ops-1");
    expect(stack.tags.get("caddy:2.11.8-alpine")).toBe("sha256:caddy-1");
    const r3 = release((s) => (s.caddy!.image = "caddy:2.13.0-alpine"));
    handedOver(stack, 3, r3);
    await apply(stack, images, r3, "sha256:ops-2");
    expect(stack.present.has("sha256:caddy-1")).toBe(true);
    expect(stack.tags.get("caddy:2.11.8-alpine")).toBe("sha256:caddy-1");
  });

  it("after a rollback, removes the pin it pulled and keeps the release's images, which the channel still names", async () => {
    const stack = FakeStack.onFiles();
    const images = new Images(stack, () => {});
    stack.registry.set("caddy:2.12.0-alpine", "sha256:caddy-2");
    const broken = release((s) => (s.caddy!.image = "caddy:2.12.0-alpine"), `${CADDYFILE}BROKEN\n`);
    stack.brokenWhen = (s, dir) => s === "caddy" && readFileSync(join(dir, "caddy/Caddyfile"), "utf8").includes("BROKEN");
    handedOver(stack, 2, broken);

    const event = await apply(stack, images, broken, "sha256:ops-1");

    expect(event?.outcome).toBe("rolled-back");
    expect(stack.present.has("sha256:caddy-2")).toBe(false);
    expect(stack.tags.has("caddy:2.12.0-alpine")).toBe(false);
    expect(stack.present.has("sha256:ops-2")).toBe(true);
    expect(stack.present.has("sha256:caddy-1")).toBe(true);
    expect(event?.detail).toMatch(/Removed 1 old image \(caddy caddy-2\): 1\.0 GB freed\.$/);
  });
});

describe("the parts", () => {
  it("name repositories, sizes and what was removed", () => {
    expect(repoOf("ghcr.io/stakwork/strut:stable")).toBe("ghcr.io/stakwork/strut");
    expect(repoOf("localhost:5055/caddy:2.11.8-e2e")).toBe("localhost:5055/caddy");
    expect(repoOf("neo4j@sha256:abc")).toBe("neo4j");
    expect(repoOf("redis")).toBe("redis");
    expect(parseSize("170.2GB")).toBe(170_200_000_000);
    expect(parseSize("512kB")).toBe(512_000);
    expect(parseSize("n/a")).toBeUndefined();
    expect(describePruned({ removed: [] })).toBe("");
    expect(describePruned({ removed: [{ service: "ops", image: { id: "sha256:1", revision: "e2e-r1" } }], freed: 362_900 })).toBe("Removed 1 old image (ops e2e-r1): 363 kB freed.");
    expect(describePruned({ removed: [{ service: "strut", image: { id: "sha256:abcdef123", revision: "2fe953a1" } }], freed: 3.64e9 })).toBe(
      "Removed 1 old image (strut 2fe953a): 3.6 GB freed.",
    );
  });
});
