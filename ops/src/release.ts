import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Container, ServiceDef, Stack } from "./compose.js";
import type { OpsEvent } from "./contract.js";
import { drainStrut, errorText, liftDrain, took, type Deps } from "./deps.js";
import { differs, pick, writeFiles, type Files } from "./files.js";
import { describePruned, type Images } from "./images.js";
import { describeChanges, healthy, releaseGroup, short } from "./update.js";

/**
 * A stadeum release: stadeum-ops's image, the stack files it carries
 * (files.ts), and stadeum-ui's image, promoted together on stadeum's
 * channel. The files pin every other image (Caddy, Redis, the gateway,
 * Neo4j), so a release moves those too.
 *
 * The ops that runs checks a release and decides whether it may go in
 * (planRelease, and ops.ts); the ops it brings applies it, from a one-off
 * container (update.ts, handOver):
 *
 *   1. Plan: stage the files, let compose read them with the box's .env
 *      and local.yml (which proves they parse), and say what changes.
 *   2. A change to a service that waits for an admin's word (Neo4j) holds
 *      the whole release, unless the admin confirmed it.
 *   3. Pull what the files name and the box lacks. Compare each service's
 *      config hash and image with its container's, and see which mount a
 *      file that changes: those are what compose recreates.
 *   4. Drain strut (unless only stadeum-ui and ops move), write the
 *      files, `compose up` what changes, and check health.
 *   5. Unhealthy: put the previous release's files back (its ops image
 *      carries them), tag the images that ran back on, and `compose up`
 *      again.
 */

export interface Move {
  service: string;
  /** Absent: a service the release adds. */
  from?: string;
  /** Absent: a service the release removes. */
  to?: string;
}

export interface Plan {
  /** The stack files that change. */
  files: string[];
  /** Their next content; null for a file the release removes. */
  write: Map<string, Buffer | null>;
  /** Their content on the box now; null where it has none. */
  before: Map<string, Buffer | null>;
  /** Each service whose image reference changes. */
  images: Move[];
  /** Of those, the ones that wait for an admin's word (`stadeum.ops.upgrade: confirm`). */
  held: Array<Required<Move>>;
  /** The services as the box's files have them, and as the release's will. */
  current: ServiceDef[];
  next: ServiceDef[];
  /** compose's hash of each next service's config. */
  hashes: Map<string, string>;
}

/**
 * What moving the box to `next` changes, touching nothing. The files are
 * staged in a directory of their own and read by compose from there.
 * `running`: the files of the release that runs, so those it has and
 * `next` does not are removed (null: an ops older than releases).
 */
export async function planRelease(stack: Stack, next: Files, running: Files | null): Promise<Plan> {
  const stage = mkdtempSync(join(tmpdir(), "release-next-"));
  try {
    writeFiles(stage, next);
    const [current, nextDefs, hashes] = await Promise.all([stack.services(), stack.services(stage), stack.hashes(stage)]);
    const all = new Map<string, Buffer | null>(next);
    for (const p of running?.keys() ?? []) if (!next.has(p)) all.set(p, null);
    const box = pick(stack.dir, all.keys());
    const files = differs(box, all);
    const images = moves(current, nextDefs);
    const confirm = new Set([...current, ...nextDefs].filter((s) => s.confirm).map((s) => s.name));
    const held = images.filter((m): m is Required<Move> => confirm.has(m.service) && !!m.from && !!m.to);
    const at = (m: Map<string, Buffer | null>) => new Map(files.map((p) => [p, m.get(p) ?? null]));
    return { files, write: at(all), before: at(box), images, held, current, next: nextDefs, hashes };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function moves(current: ServiceDef[], next: ServiceDef[]): Move[] {
  const a = new Map(current.map((s) => [s.name, s.image]));
  const b = new Map(next.map((s) => [s.name, s.image]));
  const out: Move[] = [];
  for (const service of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(service);
    const to = b.get(service);
    if (from !== to) out.push({ service, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  return out;
}

/** The tag of an image reference, or the reference: `neo4j:5.26.32` → `5.26.32`. */
export const tagOf = (ref: string) => {
  const at = ref.lastIndexOf(":");
  return at > ref.lastIndexOf("/") ? ref.slice(at + 1) : ref;
};

/** "upgrades neo4j from 5.26.32 to 5.26.40". */
export const upgrades = (held: Array<Required<Move>>) =>
  `upgrades ${held.map((h) => `${h.service} from ${tagOf(h.from)} to ${tagOf(h.to)}`).join(" and ")}`;

export interface ApplyOptions {
  /** The release to apply: the stack files this ops's image carries. */
  next: Files;
  /** The ops image that ran before this release: a rollback puts its files back. */
  previous?: string;
  /** Image references an admin confirmed: a held service may move to these. */
  confirmed: ReadonlySet<string>;
  drainMinutes: number;
  /** Old images: what moved is kept as `ops-previous`, and what nothing keeps goes at the end. */
  images?: Images;
}

/**
 * Apply the release this ops carries (in the one-off container). Null
 * when it changes nothing on this box.
 */
export async function applyRelease(d: Deps, o: ApplyOptions): Promise<OpsEvent | null> {
  const { stack } = d;
  const startedAt = d.now();
  const current = await stack.services();
  const was = new Map<string, Container>();
  for (const s of current) {
    const c = await stack.container(s.name);
    if (c) was.set(s.name, c);
  }
  const selfRef = current.find((s) => s.name === stack.self)?.image;
  const nextOps = selfRef ? await stack.imageId(selfRef) : undefined;
  // A release by its commit (the ops image's revision), else its image ID.
  const name = async (id: string | undefined) => short(id ? await stack.describe(id).catch(() => ({ id })) : undefined);
  const release = `${await name(o.previous)} → ${await name(nextOps)}`;
  const event = (outcome: OpsEvent["outcome"], detail: string, changes?: OpsEvent["changes"]): OpsEvent => ({
    kind: "update",
    outcome,
    startedAt: startedAt.toISOString(),
    endedAt: d.now().toISOString(),
    detail,
    ...(changes?.length ? { changes } : {}),
  });

  /** Every reference back on the image its container runs: the old ops tagged the release's on for this. */
  const putTagsBack = async () => {
    for (const s of current) {
      const c = was.get(s.name);
      if (c && !s.built && s.image && (await stack.imageId(s.image)) !== c.image) await stack.tag(c.image, s.image);
    }
  };

  let plan: Plan;
  let previous: Files | null;
  try {
    previous = o.previous ? await stack.releaseOf(o.previous) : null;
    plan = await planRelease(stack, o.next, previous);
  } catch (err) {
    await putTagsBack();
    return event("failed", `Release ${release} was not applied: its stack files do not work with this box's (${errorText(err)}). Nothing changed.`);
  }

  const held = plan.held.filter((h) => !o.confirmed.has(h.to));
  if (held.length) {
    await putTagsBack();
    return event("skipped", `Release ${release} is held: it ${upgrades(held)}, which cannot be undone. An admin confirms it on the Updates page, and ops backs up first.`);
  }

  const missing: string[] = [];
  for (const ref of new Set(plan.next.filter((s) => !s.built && s.image).map((s) => s.image))) {
    if (!(await stack.imageId(ref))) missing.push(ref);
  }
  try {
    if (missing.length) {
      await d.phase("updating", `pulling ${missing.join(", ")}`);
      await stack.pullImages(missing);
    }
  } catch (err) {
    await putTagsBack();
    return event("failed", `Release ${release} was not applied: ${errorText(err)}. Nothing changed.`);
  }

  // What compose recreates: a new service, a changed config or image, or a file it mounts that changes.
  const changed = plan.files.map((p) => join(stack.dir, p));
  const mounts = (s: ServiceDef) => s.binds.some((b) => changed.some((p) => p === b || p.startsWith(`${b}/`)));
  const affected: string[] = [];
  const changes: NonNullable<OpsEvent["changes"]> = [];
  for (const s of plan.next) {
    if (s.oneShot) continue;
    const c = was.get(s.name);
    const image = await stack.imageId(s.image);
    if (!c || c.image !== image || c.hash !== plan.hashes.get(s.name) || mounts(s)) affected.push(s.name);
    if (image && c?.image !== image) changes.push({ service: s.name, ...(c ? { from: await stack.describe(c.image) } : {}), to: await stack.describe(image) });
  }
  const gone = current.filter((s) => !s.oneShot && was.has(s.name) && !plan.next.some((n) => n.name === s.name)).map((s) => s.name);
  if (!affected.length && !gone.length && !plan.files.length) {
    d.log(`release ${release}: nothing to change`);
    return null;
  }

  const what = [
    `release ${release}`,
    plan.files.length ? `${plan.files.join(", ")} changed` : "",
    affected.length ? `recreated ${affected.join(", ")}` : "",
    gone.length ? `removed ${gone.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const ours = new Set(releaseGroup(current, stack.self).map((s) => s.name));
  const drain = gone.length > 0 || affected.some((n) => !ours.has(n));
  const drained = drain && (await drainStrut(d, `updating ${what}`, o.drainMinutes));
  const images = changes.length ? ` (${describeChanges(changes)})` : "";
  /** Remove what nothing keeps now, and say so in the history line. */
  const prune = async (e: OpsEvent): Promise<OpsEvent> => {
    if (!o.images) return e;
    const pruned = describePruned(await o.images.prune(await stack.services()));
    return pruned ? { ...e, detail: `${e.detail} ${pruned}` } : e;
  };
  try {
    await d.phase("updating", what);
    d.log(`updating ${what}`);
    writeFiles(stack.dir, plan.write);
    await stack.up(affected, { recreate: true });
    await healthy(d, affected);
    // What ran before each move is `ops-previous`; a pin the stack no longer names loses that name.
    for (const s of current) {
      const c = was.get(s.name);
      const now = plan.next.find((n) => n.name === s.name);
      if (!c || !now || !s.image || c.image === (await stack.imageId(now.image))) continue;
      await o.images?.moved(s.name, s.image, c.image, plan.next.some((n) => n.image === s.image));
    }
    return await prune(event("ok", `Updated ${what}${images}, in ${took(d.now().getTime() - startedAt.getTime())}.`, changes));
  } catch (err) {
    const why = errorText(err);
    d.log(`release ${release} did not come up healthy (${why}); putting the previous one back`);
    await d.phase("rolling-back", what);
    try {
      writeFiles(stack.dir, new Map(plan.files.map((p) => [p, previous ? (previous.get(p) ?? null) : (plan.before.get(p) ?? null)])));
      await putTagsBack();
      const back = [...affected.filter((n) => current.some((s) => s.name === n && !s.oneShot)), ...gone];
      await stack.up(back, { recreate: true });
      await healthy(d, back);
      // A pin pulled for this release and named by nothing now goes with its name.
      for (const ref of missing) {
        const service = plan.next.find((n) => n.image === ref)?.name ?? ref;
        if (!current.some((s) => s.image === ref)) o.images?.candidate(await stack.imageId(ref), service, ref);
      }
      return await prune(event("rolled-back", `Release ${release} did not come up healthy, so the stack files and images it replaced were put back. ${why}`, changes));
    } catch (err2) {
      return event("failed", `Release ${release} did not come up healthy, and putting the previous one back failed too: ${errorText(err2)}. First: ${why}`, changes);
    }
  } finally {
    if (drained) await liftDrain(d);
  }
}
