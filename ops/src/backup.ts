import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { OpsEvent, Snapshot } from "./contract.js";
import { drainStrut, errorText, took, type Deps } from "./deps.js";
import { resticError, type ResticApi } from "./restic.js";

/**
 * Backups. Neo4j community has no online dump, and SQLite (stadeum-ui,
 * bifrost) and redis tear mid-write, so a snapshot is taken with them
 * stopped: drain strut and wait, stop every service labelled
 * `stadeum.ops.backup: stop`, snapshot, start them again. A few minutes
 * of downtime in the window.
 *
 * What is in it: every volume mounted in ops at /volumes/<name>
 * (stack/stadeum.yml), which is every volume but strut-models, whose
 * models strut fetches again; and the env file, which holds the secrets
 * that read them (NEO4J_PASSWORD, STRUT_SECRET_KEY, STADEUM_ENCRYPTION_KEY).
 * The restic password is not: the admin keeps it off the box. A restore
 * puts back what the snapshot has and leaves any other volume as it is.
 */

export const VOLUMES = "/volumes";
/** Where the env file is copied for the snapshot, and found in it. */
export const ENV_DIR = "/env";
export const ENV_IN_SNAPSHOT = `${ENV_DIR}/.env`;

export interface BackupOptions {
  drainMinutes: number;
  /** restic's `--host`: the compose project, the same on the box that restores it. */
  host: string;
  /** The env file to keep (compose's), readable here. */
  envFile: string | undefined;
  /** Where the volumes are mounted; tests pass a directory of their own. */
  volumes?: string;
  envDir?: string;
}

const bytes = (n: number | undefined) =>
  n === undefined ? "" : n < 1e6 ? `${Math.round(n / 1e3)} kB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`;

export async function backup(d: Deps, restic: ResticApi, opts: BackupOptions): Promise<OpsEvent & { snapshot?: Snapshot }> {
  const startedAt = d.now();
  const event = (outcome: OpsEvent["outcome"], detail: string, snapshot?: Snapshot) => ({
    kind: "backup" as const,
    outcome,
    startedAt: startedAt.toISOString(),
    endedAt: d.now().toISOString(),
    detail,
    ...(snapshot ? { snapshot } : {}),
  });

  await d.phase("backing-up", "opening the repository");
  try {
    if (await restic.ensureRepo()) d.log("made a new restic repository");
  } catch (err) {
    return event("failed", `Could not open the backup repository: ${resticError(err)}`);
  }

  const defs = await d.stack.services();
  const stopping = defs.filter((s) => s.stopForBackup && s.name !== d.stack.self).map((s) => s.name);
  const envDir = opts.envDir ?? ENV_DIR;

  await drainStrut(d, "nightly backup", opts.drainMinutes);
  let snapshot: Snapshot | undefined;
  let failure: string | undefined;
  const downAt = d.now().getTime();
  try {
    await d.phase("backing-up", `stopping ${stopping.join(", ")}`);
    await d.stack.stop(stopping);
    rmSync(envDir, { recursive: true, force: true });
    mkdirSync(envDir, { recursive: true, mode: 0o700 });
    if (opts.envFile && existsSync(opts.envFile)) copyFileSync(opts.envFile, join(envDir, ".env"));
    else d.log("no env file to keep: the snapshot has the volumes only");
    await d.phase("backing-up", "taking the snapshot");
    snapshot = await restic.backup([opts.volumes ?? VOLUMES, envDir], opts.host);
  } catch (err) {
    failure = `The snapshot failed: ${resticError(err)}`;
  } finally {
    rmSync(envDir, { recursive: true, force: true });
    try {
      await d.phase("backing-up", "starting the stack again");
      await d.stack.up(stopping, { start: true });
    } catch (err) {
      failure = `${failure ? `${failure}. ` : ""}Starting ${stopping.join(", ")} again failed: ${errorText(err)}`;
    }
  }
  const down = took(d.now().getTime() - downAt);
  if (failure || !snapshot) return event("failed", failure ?? "The snapshot failed.");

  let pruned = "";
  try {
    await d.phase("backing-up", "forgetting old snapshots");
    await restic.forget();
  } catch (err) {
    pruned = ` Forgetting old snapshots failed: ${resticError(err)}.`;
  }
  const added = bytes(snapshot.added);
  return event(
    "ok",
    `Snapshot ${snapshot.id.slice(0, 8)}${added ? `, ${added} added` : ""}. Down ${down}, ${took(d.now().getTime() - startedAt.getTime())} in all.${pruned}`,
    snapshot,
  );
}

export interface Verified {
  ok: boolean;
  /** What was found, in words; never the env file's contents. */
  detail: string;
  /** Set when it didn't run: inside the upkeep window, say. */
  skipped?: string;
  /** The newest snapshot, which it read back. */
  snapshot?: string;
  time?: string;
  snapshots: number;
  /** The part of the data restic's check read. */
  subset: string;
  /** The env file's size as it came back. */
  envBytes?: number;
}

const WEEK = 7 * 86_400_000;
/** A different tenth of the data each week: all of it every ten weeks. */
export const subsetFor = (now: Date) => `${(Math.floor(now.getTime() / WEEK) % 10) + 1}/10`;

/**
 * Check the backups can be read back (stack-spec, Backups): restic's check
 * of the repository, reading a tenth of its data, and the newest
 * snapshot's env file read back. Reads only, with no lock. The env file is
 * counted, never shown: it holds the box's secrets.
 */
export async function verify(restic: ResticApi, now: Date, subset = subsetFor(now)): Promise<Verified> {
  let snapshots: Snapshot[];
  try {
    snapshots = await restic.snapshots();
  } catch (err) {
    return { ok: false, detail: `Could not list the snapshots: ${resticError(err)}`, snapshots: 0, subset };
  }
  const latest = snapshots[0];
  if (!latest) return { ok: false, detail: "The repository has no stadeum snapshot yet.", snapshots: 0, subset };
  const about = { snapshot: latest.id, time: latest.time, snapshots: snapshots.length, subset };
  const name = `${latest.id.slice(0, 8)} of ${latest.time.slice(0, 16).replace("T", " ")}`;
  try {
    await restic.check(subset);
  } catch (err) {
    return { ok: false, detail: `restic's check, reading ${subset} of the data, failed: ${resticError(err)}`, ...about };
  }
  let env: string;
  try {
    env = await restic.dump(latest.id, ENV_IN_SNAPSHOT);
  } catch (err) {
    return { ok: false, detail: `Snapshot ${name}: its env file did not come back: ${resticError(err)}`, ...about };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*=/m.test(env)) {
    return { ok: false, detail: `Snapshot ${name}: its env file came back with no setting in it.`, ...about, envBytes: env.length };
  }
  return {
    ok: true,
    detail: `Snapshot ${name}: restic's check found no error in ${subset} of the data, and its env file came back (${env.length} bytes).`,
    ...about,
    envBytes: env.length,
  };
}

export interface RestoreOptions {
  envFile: string | undefined;
  volumes?: string;
}

/**
 * Put a snapshot back: stop the stack (ops's own service too, so it does
 * not start a pass midway), empty each volume the snapshot has, restore
 * them, and put the env file back (the one it replaces is kept beside it,
 * `.env.before-restore`). The stack is left stopped: `up` starts it.
 */
export async function restore(d: Deps, restic: ResticApi, which: string, opts: RestoreOptions): Promise<OpsEvent> {
  const startedAt = d.now();
  const root = opts.volumes ?? VOLUMES;
  const snapshots = await restic.snapshots();
  const snap = which === "latest" ? snapshots[0] : snapshots.find((s) => s.id.startsWith(which));
  if (!snap) throw new Error(which === "latest" ? "the repository has no stadeum snapshot" : `no snapshot ${which}`);
  d.log(`restoring snapshot ${snap.id.slice(0, 8)} of ${snap.time}`);

  await d.phase("restoring", `stopping the stack`);
  const defs = await d.stack.services();
  await d.stack.stop(defs.map((s) => s.name));

  const inSnapshot = await restic.list(snap.id, VOLUMES);
  const mounted = existsSync(root) ? new Set(readdirSync(root)) : new Set<string>();
  const volumes = inSnapshot.filter((v) => mounted.has(v));
  for (const v of inSnapshot.filter((v) => !mounted.has(v))) d.log(`${v} is in the snapshot but not mounted here: left out`);
  for (const v of volumes) {
    const dir = join(root, v);
    for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  }
  await d.phase("restoring", `restoring ${volumes.join(", ")}`);
  await restic.restore(
    snap.id,
    volumes.map((v) => `${VOLUMES}/${v}`),
  );

  let envNote = " The snapshot had no env file; the current one is kept.";
  if (opts.envFile) {
    const env = await restic.dump(snap.id, ENV_IN_SNAPSHOT).catch(() => null);
    if (env !== null) {
      if (existsSync(opts.envFile)) renameSync(opts.envFile, `${opts.envFile}.before-restore`);
      writeFileSync(opts.envFile, env, { mode: 0o600 });
      envNote = " The env file is the snapshot's (the one it replaced is .env.before-restore).";
    }
  }
  return {
    kind: "restore",
    outcome: "ok",
    startedAt: startedAt.toISOString(),
    endedAt: d.now().toISOString(),
    detail: `Restored snapshot ${snap.id.slice(0, 8)} of ${snap.time}: ${volumes.join(", ")}.${envNote}`,
    snapshot: snap,
  };
}
