import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Exec, RunResult } from "./exec.js";
import { destinationFromEnv, Restic, resticEnv, resticError } from "./restic.js";
import { CommandError } from "./exec.js";

const dest = { repository: "s3:https://s3.example.com/bucket/box", password: "pw", env: { AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "key" } };

function fakeExec(answers: Array<Partial<RunResult>>) {
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env });
    const a = answers.shift() ?? {};
    return { code: a.code ?? 0, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
  };
  return { exec, calls };
}

describe("restic's environment", () => {
  it("names the repository, the password and the backend's credentials", () => {
    const env = resticEnv(dest, { PATH: "/bin" });
    expect(env).toMatchObject({ PATH: "/bin", RESTIC_REPOSITORY: dest.repository, RESTIC_PASSWORD: "pw", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "key" });
  });

  it("writes a GCS service account key to a file only ops can read", () => {
    const key = '{"type":"service_account","project_id":"p"}';
    for (const value of [key, Buffer.from(key).toString("base64")]) {
      const env = resticEnv({ ...dest, env: { GOOGLE_PROJECT_ID: "p", GOOGLE_APPLICATION_CREDENTIALS_JSON: value } }, {});
      expect(env.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBeUndefined();
      expect(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8")).toBe(key);
      expect(statSync(env.GOOGLE_APPLICATION_CREDENTIALS!).mode & 0o777).toBe(0o600);
    }
  });

  it("comes from RESTIC_REPOSITORY and RESTIC_PASSWORD on a fresh box", () => {
    expect(destinationFromEnv({ RESTIC_REPOSITORY: "/backups/r", RESTIC_PASSWORD: "x" })).toEqual({ repository: "/backups/r", password: "x", env: {} });
    expect(destinationFromEnv({ RESTIC_REPOSITORY: "/backups/r" })).toBeNull();
  });
});

describe("the restic client", () => {
  it("makes the repository when restic says there is none, and only then", async () => {
    const made = fakeExec([{ code: 10, stderr: "Fatal: repository does not exist" }, {}]);
    expect(await new Restic(dest, made.exec).ensureRepo()).toBe(true);
    expect(made.calls.map((c) => c.args[0])).toEqual(["cat", "init"]);
    expect(made.calls[1]!.env?.RESTIC_PASSWORD).toBe("pw");

    const there = fakeExec([{ code: 0 }]);
    expect(await new Restic(dest, there.exec).ensureRepo()).toBe(false);

    const wrong = fakeExec([{ code: 12, stderr: "Fatal: wrong password or no key found" }]);
    const err = await new Restic(dest, wrong.exec).ensureRepo().catch((e: unknown) => e);
    expect(resticError(err)).toBe("wrong password or no key found");
  });

  it("reads the snapshot from backup's summary", async () => {
    const stdout = [
      '{"message_type":"status","percent_done":0.5}',
      '{"message_type":"summary","snapshot_id":"abc123","data_added":4096}',
    ].join("\n");
    const { exec, calls } = fakeExec([{ stdout }]);
    const snap = await new Restic(dest, exec).backup(["/volumes", "/env"], "stadeum");
    expect(snap).toMatchObject({ id: "abc123", added: 4096 });
    expect(calls[0]!.args).toEqual(["backup", "--json", "--host", "stadeum", "--tag", "stadeum", "/volumes", "/env"]);
  });

  it("keeps 7 daily, 4 weekly and 12 monthly", async () => {
    const { exec, calls } = fakeExec([{}]);
    await new Restic(dest, exec).forget();
    expect(calls[0]!.args).toEqual(["forget", "--tag", "stadeum", "--prune", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "12"]);
  });

  it("lists snapshots newest first, and what is directly under a directory", async () => {
    const { exec } = fakeExec([
      { stdout: JSON.stringify([{ id: "a", time: "2026-11-03T03:00:00Z" }, { id: "b", time: "2026-11-04T03:00:00Z", summary: { data_added: 7 } }]) },
      {
        stdout: [
          '{"struct_type":"snapshot","id":"b"}',
          '{"struct_type":"node","path":"/volumes","type":"dir"}',
          '{"struct_type":"node","path":"/volumes/neo4j","type":"dir"}',
          '{"struct_type":"node","path":"/volumes/neo4j/databases","type":"dir"}',
          '{"struct_type":"node","path":"/volumes/org","type":"dir"}',
        ].join("\n"),
      },
    ]);
    const r = new Restic(dest, exec);
    expect(await r.snapshots()).toEqual([{ id: "b", time: "2026-11-04T03:00:00Z", added: 7 }, { id: "a", time: "2026-11-03T03:00:00Z" }]);
    expect(await r.list("b", "/volumes")).toEqual(["neo4j", "org"]);
  });

  it("reads without a lock: listings, a file, and its check, so a backup beside them never fails", async () => {
    const { exec, calls } = fakeExec([{ stdout: "[]" }, { stdout: "" }, { stdout: "A=1\n" }, {}]);
    const r = new Restic(dest, exec);
    await r.snapshots();
    await r.list("b", "/volumes");
    expect(await r.dump("b", "/env/.env")).toBe("A=1\n");
    await r.check("3/10");
    expect(calls.map((c) => c.args)).toEqual([
      ["snapshots", "--no-lock", "--json", "--tag", "stadeum"],
      ["ls", "--no-lock", "--json", "b", "/volumes"],
      ["dump", "--no-lock", "b", "/env/.env"],
      ["check", "--no-lock", "--read-data-subset", "3/10"],
    ]);
  });

  it("restores to where the files were", async () => {
    const { exec, calls } = fakeExec([{}]);
    await new Restic(dest, exec).restore("b", ["/volumes/neo4j", "/volumes/org"]);
    expect(calls[0]!.args).toEqual(["restore", "b", "--target", "/", "--include", "/volumes/neo4j", "--include", "/volumes/org"]);
  });

  it("says restic's last line on a failure", () => {
    const err = new CommandError("restic", ["backup"], { code: 1, stdout: "", stderr: "repository opened\nFatal: unable to save snapshot: bucket gone\n" });
    expect(resticError(err)).toBe("unable to save snapshot: bucket gone");
  });

  it("reads restic's fatal error when it says it as JSON (--json)", () => {
    // restic 0.18.1's own words, for a wrong password on `snapshots --json`.
    const stderr = '{"message_type":"exit_error","code":12,"message":"Fatal: wrong password or no key found"}\n';
    expect(resticError(new CommandError("restic", ["snapshots"], { code: 12, stdout: "", stderr }))).toBe("wrong password or no key found");
    const missing = '{"message_type":"exit_error","code":10,"message":"Fatal: repository does not exist: unable to open config file\\nIs there a repository at the following location?"}';
    expect(resticError(new CommandError("restic", ["snapshots"], { code: 10, stdout: "", stderr: missing }))).toBe("repository does not exist: unable to open config file");
  });
});
