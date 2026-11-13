import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Destination, Snapshot } from "./contract.js";
import { CommandError, must, type Exec } from "./exec.js";

/**
 * restic, which speaks S3 (and R2, MinIO), Azure Blob, GCS, B2, SFTP and a
 * local path. Every snapshot ops takes is tagged `stadeum`; the policy
 * keeps 7 daily, 4 weekly and 12 monthly.
 */

export const TAG = "stadeum";
export const RETENTION = ["--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "12"];

/** restic's exit code for "the repository does not exist" (0.17+). */
const NO_REPOSITORY = 10;

/** A service account key carried as content; restic wants a file. */
const GCS_JSON = "GOOGLE_APPLICATION_CREDENTIALS_JSON";

/** The environment restic runs with: the destination over `base`. */
export function resticEnv(dest: Destination, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...dest.env, RESTIC_REPOSITORY: dest.repository, RESTIC_PASSWORD: dest.password };
  const key = env[GCS_JSON]?.trim();
  if (key) {
    const dir = mkdtempSync(join(tmpdir(), "gcs-"));
    const file = join(dir, "key.json");
    writeFileSync(file, key.startsWith("{") ? key : Buffer.from(key, "base64").toString("utf8"), { mode: 0o600 });
    chmodSync(file, 0o600);
    env.GOOGLE_APPLICATION_CREDENTIALS = file;
  }
  delete env[GCS_JSON];
  return env;
}

/** A destination named by the environment (`RESTIC_REPOSITORY` + `RESTIC_PASSWORD`), as on a fresh box. */
export function destinationFromEnv(env: NodeJS.ProcessEnv): Destination | null {
  const repository = env.RESTIC_REPOSITORY?.trim();
  const password = env.RESTIC_PASSWORD;
  if (!repository || !password) return null;
  return { repository, password, env: {} };
}

/** restic's last word on a failure, without the usage text. */
export function resticError(err: unknown): string {
  if (err instanceof CommandError) {
    const said = (err.result.stderr || err.result.stdout).trim().split("\n").filter((l) => !/^\s*$/.test(l));
    let last = said.at(-1) ?? err.message;
    // With --json, restic says its fatal error as JSON too.
    try {
      const j = JSON.parse(last) as { message_type?: string; message?: unknown };
      if (j.message_type === "exit_error" && typeof j.message === "string") last = j.message.split("\n")[0]!;
    } catch {
      // Plain text.
    }
    return last.replace(/^Fatal:\s*/, "").slice(0, 300);
  }
  return (err as Error).message;
}

/** What backups, restores and checks use; tests pass a fake. */
export type ResticApi = Pick<Restic, "ensureRepo" | "backup" | "forget" | "snapshots" | "list" | "restore" | "dump" | "check">;

export class Restic {
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    dest: Destination,
    private readonly exec: Exec,
  ) {
    this.env = resticEnv(dest);
  }

  private run(args: string[], inherit = false): Promise<string> {
    return must(this.exec, "restic", args, { env: this.env, inherit });
  }

  /** Open the repository, making it on first use. True when it was made now. */
  async ensureRepo(): Promise<boolean> {
    const r = await this.exec("restic", ["cat", "config", "--no-lock"], { env: this.env });
    if (r.code === 0) return false;
    if (r.code !== NO_REPOSITORY) throw new CommandError("restic", ["cat", "config"], r);
    await this.run(["init"]);
    return true;
  }

  async backup(paths: string[], host: string): Promise<Snapshot> {
    const out = await this.run(["backup", "--json", "--host", host, "--tag", TAG, ...paths]);
    const summary = out
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l) as { message_type?: string; snapshot_id?: string; data_added?: number };
        } catch {
          return {};
        }
      })
      .find((m) => m.message_type === "summary");
    if (!summary?.snapshot_id) throw new Error("restic backup reported no snapshot");
    return { id: summary.snapshot_id, time: new Date().toISOString(), ...(summary.data_added !== undefined ? { added: summary.data_added } : {}) };
  }

  async forget(): Promise<void> {
    await this.run(["forget", "--tag", TAG, "--prune", ...RETENTION]);
  }

  /** Newest first. Reads take no lock: a check or a listing never stands in a backup's way. */
  async snapshots(): Promise<Snapshot[]> {
    const list = JSON.parse(await this.run(["snapshots", "--no-lock", "--json", "--tag", TAG])) as Array<{
      id: string;
      time: string;
      summary?: { data_added?: number };
    }>;
    return list
      .map((s) => ({ id: s.id, time: s.time, ...(s.summary?.data_added !== undefined ? { added: s.summary.data_added } : {}) }))
      .sort((a, b) => b.time.localeCompare(a.time));
  }

  /** The names directly under `dir` in a snapshot. */
  async list(snapshot: string, dir: string): Promise<string[]> {
    const out = await this.run(["ls", "--no-lock", "--json", snapshot, dir]);
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    return out
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l) as { struct_type?: string; path?: string };
        } catch {
          return {};
        }
      })
      .filter((n) => n.struct_type === "node" && n.path?.startsWith(prefix))
      .map((n) => n.path!.slice(prefix.length))
      .filter((rest) => rest && !rest.includes("/"));
  }

  /** Put `paths` back where they were (`--target /`). */
  async restore(snapshot: string, paths: string[]): Promise<void> {
    await this.run(["restore", snapshot, "--target", "/", ...paths.flatMap((p) => ["--include", p])], true);
  }

  async dump(snapshot: string, path: string): Promise<string> {
    return this.run(["dump", "--no-lock", snapshot, path]);
  }

  /**
   * restic's own check of the repository, reading `subset` of its data
   * (`n/t`: the n-th of t parts). Without a lock: a plain check takes an
   * exclusive one, and a backup that started beside it would fail.
   */
  async check(subset: string): Promise<void> {
    await this.run(["check", "--no-lock", "--read-data-subset", subset]);
  }
}
