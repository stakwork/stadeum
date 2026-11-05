import type { ServiceDef, Stack } from "./compose.js";
import type { ImageRef, OpsEvent } from "./contract.js";
import { drainStrut, errorText, liftDrain, took, type Deps } from "./deps.js";

/**
 * Updates. A service with a `stadeum.ops.update: <group>` label follows
 * the channel its image names (`…:stable`); a group moves together (strut
 * and strut-browser: their Playwright versions must match). ops's own
 * group (stadeum-ui and ops) is a release, with the stack files ops's
 * image carries, and moves as one (release.ts). Every other service moves
 * when a release changes its pin.
 *
 *   1. Pull the group, and compare the image ID each reference now names
 *      with the one its container runs.
 *   2. If any differ, drain strut (a group with strut in it) and wait.
 *   3. `compose up --wait`: recreate what changed and wait for health.
 *   4. Unhealthy: tag the images it replaced back and recreate again.
 *   5. Record what changed.
 */

export interface Group {
  name: string;
  services: ServiceDef[];
}

export interface Check {
  service: ServiceDef;
  /** The image ID its container was made from. */
  running?: string;
  /** The image ID its reference names after the pull. */
  available?: string;
  /** The image ID its reference named before the pull. */
  before?: string;
}

/** Strut's service name: a group with it in is drained first. */
export const STRUT = "strut";

/** The update groups, by name: those of services made on this box (dev) and the release's are left out. */
export function updateGroups(defs: ServiceDef[], self: string): Group[] {
  const release = new Set(releaseGroup(defs, self).map((s) => s.name));
  const groups = new Map<string, ServiceDef[]>();
  for (const s of defs) {
    if (!s.group || s.built || s.name === self || release.has(s.name)) continue;
    groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  }
  return [...groups].map(([name, services]) => ({ name, services })).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** strut's group first: it is the one that drains. */
const rank = (g: Group) => (g.services.some((s) => s.name === STRUT) ? 0 : 1);

export const isNewer = (c: Check) => !!c.available && c.available !== c.running;

/** Pull and compare. Nothing that runs is touched. */
export async function checkGroup(stack: Stack, services: ServiceDef[]): Promise<Check[]> {
  const before = await Promise.all(services.map((s) => stack.imageId(s.image)));
  await stack.pull(services.map((s) => s.name));
  return Promise.all(
    services.map(async (service, i) => {
      const [running, available] = await Promise.all([stack.running(service.name), stack.imageId(service.image)]);
      const was = before[i];
      return { service, ...(running ? { running } : {}), ...(available ? { available } : {}), ...(was ? { before: was } : {}) };
    }),
  );
}

export interface UpdateOptions {
  /** An admin's "Update now": try an image even if it failed before. */
  force: boolean;
  /** Image IDs that failed their health check before. */
  failed: ReadonlySet<string>;
  drainMinutes: number;
}

export const short = (r: ImageRef | undefined) => (r ? (r.revision ?? r.id.replace(/^sha256:/, "")).slice(0, 7) : "none");

export function describeChanges(changes: NonNullable<OpsEvent["changes"]>): string {
  return changes.map((c) => `${c.service} ${short(c.from)} → ${short(c.to)}`).join(", ");
}

/**
 * Move one group onto what its channel has. Null when nothing moved: up to
 * date, or held back on an image that failed before (its tag is put back
 * on what runs, so a person's `compose up` does not bring it back either).
 */
export async function updateGroup(d: Deps, group: Group, checks: Check[], opts: UpdateOptions): Promise<OpsEvent | null> {
  const moving = checks.filter(isNewer);
  if (!moving.length) return null;

  if (!opts.force && moving.every((c) => opts.failed.has(c.available!))) {
    for (const c of moving) if (c.running) await d.stack.tag(c.running, c.service.image);
    d.log(`${group.name}: held back, the channel's image failed its health check before`);
    return null;
  }

  const startedAt = d.now();
  const changes = await Promise.all(
    moving.map(async (c) => ({
      service: c.service.name,
      ...(c.running ? { from: await d.stack.describe(c.running) } : {}),
      to: await d.stack.describe(c.available!),
    })),
  );
  const what = describeChanges(changes);
  const names = group.services.map((s) => s.name);
  const event = (outcome: OpsEvent["outcome"], detail: string): OpsEvent => ({
    kind: "update",
    outcome,
    startedAt: startedAt.toISOString(),
    endedAt: d.now().toISOString(),
    detail,
    changes,
  });

  const drained = names.includes(STRUT) && (await drainStrut(d, `updating ${what}`, opts.drainMinutes));
  try {
    await d.phase("updating", what);
    d.log(`updating ${what}`);
    await d.stack.up(names);
    await healthy(d, names);
    return event("ok", `Updated ${what} in ${took(d.now().getTime() - startedAt.getTime())}.`);
  } catch (err) {
    const why = errorText(err);
    d.log(`${group.name} did not come up healthy (${why}); putting the old images back`);
    await d.phase("rolling-back", what);
    try {
      for (const c of moving) if (c.running) await d.stack.tag(c.running, c.service.image);
      await d.stack.up(names);
      await healthy(d, names);
      return event("rolled-back", `${what} did not come up healthy, so the images it replaced were put back. ${why}`);
    } catch (err2) {
      return event("failed", `${what} did not come up healthy, and putting the old images back failed too: ${errorText(err2)}. First: ${why}`);
    }
  } finally {
    if (drained) await liftDrain(d);
  }
}

const HEALTH_TRIES = 24;
const HEALTH_EVERY_MS = 5_000;

/**
 * Beyond the containers' own healthchecks (`compose up --wait`): strut
 * answers `/health` with the key, i.e. its API is serving.
 */
export async function healthy(d: Deps, services: string[]): Promise<void> {
  if (!services.includes(STRUT)) return;
  let last = "";
  for (let i = 0; i < HEALTH_TRIES; i++) {
    try {
      const h = await d.strut.health();
      if (h.ok && h.workspace) return;
      last = h.ok ? "strut did not accept the key" : "strut is not ok";
    } catch (err) {
      last = errorText(err);
    }
    await d.sleep(HEALTH_EVERY_MS);
  }
  throw new Error(`strut's /health: ${last}`);
}

// ── the release ─────────────────────────────────────────────────────────

/**
 * ops's own service, when it follows a channel. Built here (stack/dev.yml)
 * or pinned to no channel, it has no releases: the files are the
 * checkout's, and nothing writes them but a person.
 */
export function selfDef(defs: ServiceDef[], self: string): ServiceDef | undefined {
  const s = defs.find((d) => d.name === self);
  return s?.group && !s.built ? s : undefined;
}

/** The release's services: ops's own update group (stadeum-ui and ops). */
export function releaseGroup(defs: ServiceDef[], self: string): ServiceDef[] {
  const sd = selfDef(defs, self);
  return sd ? defs.filter((s) => s.group === sd.group && !s.built) : [];
}

/**
 * Hand the release to the ops it brings. ops cannot run the compose up
 * that recreates the container it runs in (compose would stop it
 * halfway), and the files are the new ops's to put in place: a one-off ops
 * container on the new image (`ops hand-over <previous ops image>`)
 * applies the release (release.ts, applyRelease), the ops service with
 * it, and puts it all back if it does not come up. The release's images
 * get their tags here, for the one-off and its compose up; they go back
 * on what runs if it does not start.
 */
export async function handOver(d: Deps, checks: Check[], confirmed: string[]): Promise<void> {
  const self = checks.find((c) => c.service.name === d.stack.self);
  d.log(`release ${short({ id: self?.running ?? "" })} → ${short({ id: self?.available ?? self?.running ?? "" })}: handing over`);
  try {
    for (const c of checks) if (c.available) await d.stack.tag(c.available, c.service.image);
    await d.stack.spawnSelf(["hand-over", self?.running ?? "", ...(confirmed.length ? ["--confirm", confirmed.join(",")] : [])]);
  } catch (err) {
    for (const c of checks) if (c.running) await d.stack.tag(c.running, c.service.image).catch(() => undefined);
    throw err;
  }
}
