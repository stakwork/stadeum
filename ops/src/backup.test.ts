import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { backup, restore, subsetFor, verify } from "./backup.js";
import { deps, FakeRestic, FakeStack, FakeStrut } from "./test/fakes.js";

function box() {
  const dir = mkdtempSync(join(tmpdir(), "ops-backup-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "NEO4J_PASSWORD=secret\n");
  const volumes = join(dir, "volumes");
  for (const v of ["neo4j", "stadeum-ui", "caddy"]) mkdirSync(join(volumes, v), { recursive: true });
  return { dir, envFile, volumes, envDir: join(dir, "env") };
}

describe("a backup", () => {
  it("drains strut, stops what tears, snapshots the volumes and the env file, starts them again, then forgets old snapshots", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    const restic = new FakeRestic();
    const b = box();
    let envSeen = "";
    const snap = restic.backup.bind(restic);
    restic.backup = async (paths, host) => {
      envSeen = readFileSync(join(b.envDir, ".env"), "utf8");
      return snap(paths, host);
    };

    const event = await backup(deps(stack, strut).d, restic, { drainMinutes: 30, host: "stadeum", envFile: b.envFile, volumes: b.volumes, envDir: b.envDir });

    expect(event.outcome).toBe("ok");
    expect(event.detail).toMatch(/^Snapshot snap1aaa, 2\.5 MB added\. Down \d+ s/);
    expect(strut.calls).toEqual(["drain 60 nightly backup"]);
    expect(stack.calls).toEqual(["stop neo4j redis bifrost strut stadeum-ui", "up --no-recreate neo4j redis bifrost strut stadeum-ui"]);
    expect(restic.calls).toEqual(["open", `backup stadeum ${b.volumes} ${b.envDir}`, "forget"]);
    expect(envSeen).toBe("NEO4J_PASSWORD=secret\n");
    // The copy of the secrets does not outlive the snapshot.
    expect(existsSync(b.envDir)).toBe(false);
  });

  it("starts the stack again when the snapshot fails", async () => {
    const stack = FakeStack.standard();
    const restic = new FakeRestic();
    restic.failBackup = true;
    const b = box();
    const event = await backup(deps(stack, new FakeStrut()).d, restic, { drainMinutes: 30, host: "stadeum", envFile: b.envFile, volumes: b.volumes, envDir: b.envDir });
    expect(event.outcome).toBe("failed");
    expect(event.detail).toBe("The snapshot failed: bucket not found");
    expect(stack.calls.at(-1)).toMatch(/^up --no-recreate/);
    expect(restic.calls).not.toContain("forget");
    expect(existsSync(b.envDir)).toBe(false);
  });

  it("stops nothing when the repository will not open", async () => {
    const stack = FakeStack.standard();
    const strut = new FakeStrut();
    const restic = new FakeRestic();
    restic.failOpen = true;
    const event = await backup(deps(stack, strut).d, restic, { drainMinutes: 30, host: "stadeum", envFile: undefined });
    expect(event.outcome).toBe("failed");
    expect(event.detail).toMatch(/Could not open the backup repository: wrong password/);
    expect(stack.calls).toEqual([]);
    expect(strut.calls).toEqual([]);
  });

  it("makes the repository on first use", async () => {
    const restic = new FakeRestic();
    restic.repoExists = false;
    const b = box();
    const { d, log } = deps(FakeStack.standard(), new FakeStrut());
    const event = await backup(d, restic, { drainMinutes: 30, host: "stadeum", envFile: b.envFile, volumes: b.volumes, envDir: b.envDir });
    expect(event.outcome).toBe("ok");
    expect(log).toContain("made a new restic repository");
  });
});

describe("a restore", () => {
  it("stops the stack, empties the volumes the snapshot has, restores them and puts its env file back", async () => {
    const stack = FakeStack.standard();
    const restic = new FakeRestic();
    restic.snaps = [
      { id: "bbbbbbbb2", time: "2026-11-05T03:05:00Z" },
      { id: "aaaaaaaa1", time: "2026-11-04T03:05:00Z" },
    ];
    restic.volumes = ["neo4j", "stadeum-ui", "gone"];
    restic.env = "NEO4J_PASSWORD=from-the-snapshot\n";
    const b = box();
    writeFileSync(join(b.volumes, "neo4j", "store"), "new data");
    writeFileSync(join(b.volumes, "caddy", "cert"), "kept");

    const { d, log } = deps(stack, new FakeStrut());
    const event = await restore(d, restic, "latest", { envFile: b.envFile, volumes: b.volumes });

    expect(event.outcome).toBe("ok");
    expect(stack.calls).toEqual([`stop ${stack.defs.map((s) => s.name).join(" ")}`]);
    expect(readdirSync(join(b.volumes, "neo4j"))).toEqual([]);
    expect(readdirSync(join(b.volumes, "caddy"))).toEqual(["cert"]);
    expect(restic.calls).toEqual(["restore bbbbbbbb2 /volumes/neo4j /volumes/stadeum-ui"]);
    expect(log).toContain("gone is in the snapshot but not mounted here: left out");
    expect(readFileSync(b.envFile, "utf8")).toBe("NEO4J_PASSWORD=from-the-snapshot\n");
    expect(readFileSync(`${b.envFile}.before-restore`, "utf8")).toBe("NEO4J_PASSWORD=secret\n");
  });

  it("restores the snapshot it is given by its id's start", async () => {
    const restic = new FakeRestic();
    restic.snaps = [
      { id: "bbbbbbbb2", time: "2026-11-05T03:05:00Z" },
      { id: "aaaaaaaa1", time: "2026-11-04T03:05:00Z" },
    ];
    restic.volumes = ["neo4j"];
    const b = box();
    const event = await restore(deps(FakeStack.standard(), new FakeStrut()).d, restic, "aaaa", { envFile: b.envFile, volumes: b.volumes });
    expect(event.detail).toMatch(/^Restored snapshot aaaaaaaa .*the current one is kept/);
    expect(readFileSync(b.envFile, "utf8")).toBe("NEO4J_PASSWORD=secret\n");
  });

  it("refuses a snapshot the repository does not have", async () => {
    const restic = new FakeRestic();
    await expect(restore(deps(FakeStack.standard(), new FakeStrut()).d, restic, "latest", { envFile: undefined })).rejects.toThrow(/no stadeum snapshot/);
  });
});

describe("verifying the backups", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const withSnapshots = () => {
    const restic = new FakeRestic();
    restic.snaps = [
      { id: "b2c3d4e5f6a7", time: "2026-11-10T03:12:00Z" },
      { id: "a1b2c3d4e5f6", time: "2026-11-09T03:11:00Z" },
    ];
    restic.env = "NEO4J_PASSWORD=secret\nSTADEUM_HOST=acme.example.com\n";
    return restic;
  };

  it("checks a tenth of the data, reads the newest snapshot's env file back, and never says what is in it", async () => {
    const restic = withSnapshots();
    const v = await verify(restic, now);
    expect(v).toEqual({
      ok: true,
      detail: `Snapshot b2c3d4e5 of 2026-11-10 03:12: restic's check found no error in ${subsetFor(now)} of the data, and its env file came back (52 bytes).`,
      snapshot: "b2c3d4e5f6a7",
      time: "2026-11-10T03:12:00Z",
      snapshots: 2,
      subset: subsetFor(now),
      envBytes: 52,
    });
    expect(restic.calls).toEqual([`check ${subsetFor(now)}`]);
    expect(JSON.stringify(v)).not.toContain("secret");
  });

  it("reads a different tenth each week, all of it every ten weeks", () => {
    const weeks = Array.from({ length: 10 }, (_, i) => subsetFor(new Date(now.getTime() + i * 7 * 86_400_000)));
    expect(new Set(weeks).size).toBe(10);
    expect(weeks.every((s) => /^(10|[1-9])\/10$/.test(s))).toBe(true);
  });

  it("fails when there is nothing to check, the check fails, or the env file doesn't come back whole", async () => {
    expect(await verify(new FakeRestic(), now, "1/10")).toMatchObject({ ok: false, detail: "The repository has no stadeum snapshot yet.", snapshots: 0 });

    const broken = withSnapshots();
    broken.failCheck = "pack 3f2a… is damaged";
    expect(await verify(broken, now, "1/10")).toMatchObject({ ok: false, detail: "restic's check, reading 1/10 of the data, failed: pack 3f2a… is damaged", snapshot: "b2c3d4e5f6a7" });

    const lost = withSnapshots();
    lost.env = null;
    expect((await verify(lost, now, "1/10")).detail).toBe("Snapshot b2c3d4e5 of 2026-11-10 03:12: its env file did not come back: no /env/.env");

    const empty = withSnapshots();
    empty.env = "\n";
    expect(await verify(empty, now, "1/10")).toMatchObject({ ok: false, detail: "Snapshot b2c3d4e5 of 2026-11-10 03:12: its env file came back with no setting in it.", envBytes: 1 });
  });
});
