import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { boxPath, ComposeStack, parseHashes, parseProject, parseServices } from "./compose.js";
import type { Exec } from "./exec.js";

const labels = {
  "com.docker.compose.project": "stadeum",
  "com.docker.compose.project.working_dir": "/srv/stadeum/stack",
  "com.docker.compose.project.config_files": "/srv/stadeum/stack/stadeum.yml,/srv/stadeum/stack/dev.yml",
  "com.docker.compose.project.environment_file": "/srv/stadeum/.env",
  "com.docker.compose.service": "ops",
};

describe("the compose project", () => {
  it("is read from compose's labels on ops's own container", () => {
    expect(parseProject(labels)).toEqual({
      name: "stadeum",
      workingDir: "/srv/stadeum/stack",
      files: ["/srv/stadeum/stack/stadeum.yml", "/srv/stadeum/stack/dev.yml"],
      envFiles: ["/srv/stadeum/.env"],
      self: "ops",
    });
  });

  it("finds the box's directory at the path compose names it, under any prefix the daemon adds", () => {
    const files = ["/Users/ada/stadeum/stack/stadeum.yml", "/Users/ada/stadeum/stack/dev.yml"];
    expect(boxPath("/host_mnt/Users/ada/stadeum", files)).toBe("/Users/ada/stadeum");
    expect(boxPath("/srv/stadeum", ["/srv/stadeum/stack/stadeum.yml"])).toBe("/srv/stadeum");
    expect(boxPath("/elsewhere", ["/srv/stadeum/stack/stadeum.yml"])).toBe("/elsewhere");
  });

  it("refuses a container compose did not start", () => {
    expect(() => parseProject({})).toThrow(/not running under docker compose/);
  });

  it("reads from the labels the update groups, what stops for a backup and what waits for an admin; and the one-shots and bind mounts", () => {
    const services = parseServices({
      services: {
        neo4j: { image: "neo4j:5.26.32", restart: "unless-stopped", labels: { "stadeum.ops.backup": "stop", "stadeum.ops.upgrade": "confirm" } },
        strut: { image: "ghcr.io/stakwork/strut:stable", restart: "unless-stopped", labels: { "stadeum.ops.update": "strut", "stadeum.ops.backup": "stop" } },
        "stadeum-ui": { image: "stadeum-ui:dev", restart: "unless-stopped", build: { context: "../ui" }, labels: { "stadeum.ops.update": "stadeum" } },
        caddy: {
          image: "caddy:2.11.8-alpine",
          restart: "unless-stopped",
          volumes: [{ type: "bind", source: "/srv/stadeum/stack/caddy/Caddyfile" }, { type: "volume", source: "caddy" }],
        },
        bootstrap: { image: "node:22.20.0-alpine", restart: "no" },
      },
    });
    const base = { built: false, stopForBackup: false, oneShot: false, confirm: false, binds: [] };
    expect(services).toEqual([
      { ...base, name: "neo4j", image: "neo4j:5.26.32", stopForBackup: true, confirm: true },
      { ...base, name: "strut", image: "ghcr.io/stakwork/strut:stable", group: "strut", stopForBackup: true },
      { ...base, name: "stadeum-ui", image: "stadeum-ui:dev", built: true, group: "stadeum" },
      { ...base, name: "caddy", image: "caddy:2.11.8-alpine", binds: ["/srv/stadeum/stack/caddy/Caddyfile"] },
      { ...base, name: "bootstrap", image: "node:22.20.0-alpine", oneShot: true },
    ]);
  });

  it("reads compose's config hashes", () => {
    expect(parseHashes("caddy 876d14\nops 1f2e3d\n")).toEqual(new Map([["caddy", "876d14"], ["ops", "1f2e3d"]]));
  });
});

describe("driving compose", () => {
  function stack() {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    return { s: new ComposeStack(parseProject(labels), exec), calls };
  }
  const base = [
    "compose",
    "-p",
    "stadeum",
    "--project-directory",
    "/srv/stadeum/stack",
    "-f",
    "/srv/stadeum/stack/stadeum.yml",
    "-f",
    "/srv/stadeum/stack/dev.yml",
    "--env-file",
    "/srv/stadeum/.env",
  ];

  it("runs the same files and env file the stack was started with", async () => {
    const { s, calls } = stack();
    await s.pull(["strut-browser", "strut"]);
    expect(calls[0]).toEqual([...base, "pull", "--quiet", "strut-browser", "strut"]);
  });

  it("recreates what changed and waits for health, pulling and building nothing", async () => {
    const { s, calls } = stack();
    await s.up(["strut"]);
    await s.up(["neo4j"], { start: true });
    await s.up(["caddy", "ops"], { recreate: true });
    expect(calls[0]).toEqual([...base, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "600", "strut"]);
    expect(calls[1]).toContain("--no-recreate");
    expect(calls[2]).toEqual([...base, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "--remove-orphans", "--wait", "--wait-timeout", "600", "caddy", "ops"]);
  });

  it("applies the box's local.yml when there is one, after the stack's own files, and reads a release's files in place of the box's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-compose-"));
    const release = mkdtempSync(join(tmpdir(), "ops-release-"));
    writeFileSync(join(release, "stadeum.yml"), "services: {}\n");
    const s = new ComposeStack(parseProject({ ...labels, "com.docker.compose.project.config_files": `${dir}/stadeum.yml,${dir}/dev.yml` }), async () => ({ code: 0, stdout: "", stderr: "" }));
    expect(s.dir).toBe(dir);
    expect(s.files()).toEqual([`${dir}/stadeum.yml`, `${dir}/dev.yml`]);
    writeFileSync(join(dir, "local.yml"), "services: {}\n");
    expect(s.files()).toEqual([`${dir}/stadeum.yml`, `${dir}/dev.yml`, `${dir}/local.yml`]);
    expect(s.files(release)).toEqual([`${release}/stadeum.yml`, `${dir}/dev.yml`, `${dir}/local.yml`]);
  });

  it("says which step failed and compose's last line, not the command", async () => {
    const exec: Exec = async () => ({ code: 1, stdout: "", stderr: " Container x-strut-1 Waiting\ncontainer x-strut-1 is unhealthy\n" });
    const s = new ComposeStack(parseProject(labels), exec);
    await expect(s.up(["strut-browser", "strut"])).rejects.toThrow(/^recreating strut-browser, strut: container x-strut-1 is unhealthy$/);
  });

  it("gives what it stops time to shut down cleanly", async () => {
    const { s, calls } = stack();
    await s.stop(["neo4j"]);
    expect(calls[0]).toEqual([...base, "stop", "--timeout", "120", "neo4j"]);
  });

  it("reads what every container on the machine runs, what each image would free, and its names, and removes one by name or ID", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      const out =
        args[0] === "ps" ? "c1\nc2\n"
        : args[0] === "inspect" ? "sha256:a\nsha256:b\n"
        : args[0] === "system" ? '[{"ID":"sha256:a","UniqueSize":"1.5GB"},{"ID":"sha256:b","UniqueSize":"362.9kB"},{"ID":"sha256:c","UniqueSize":"0B"}]\n'
        : args[1] === "inspect" ? '["ghcr.io/stakwork/strut:ops-previous"]\n'
        : "";
      return { code: args[1] === "rm" && args[2] === "in-use" ? 1 : 0, stdout: out, stderr: "" };
    };
    const s = new ComposeStack(parseProject(labels), exec);
    expect(await s.imagesInUse()).toEqual(new Set(["sha256:a", "sha256:b"]));
    expect(calls[0]).toEqual(["ps", "-aq", "--no-trunc"]);
    expect(await s.uniqueSizes()).toEqual(new Map([["sha256:a", 1_500_000_000], ["sha256:b", 362_900], ["sha256:c", 0]]));
    expect(await s.names("sha256:a")).toEqual(["ghcr.io/stakwork/strut:ops-previous"]);
    expect(await s.untag("ghcr.io/stakwork/strut:ops-previous")).toBe(true);
    expect(await s.removeImage("in-use")).toBe(false);
    expect(calls.at(-1)).toEqual(["image", "rm", "in-use"]);
  });

  it("hands over to a one-off ops container", async () => {
    const { s, calls } = stack();
    await s.spawnSelf(["hand-over", "sha256:old"]);
    expect(calls[0]).toEqual([...base, "run", "-d", "--rm", "--no-deps", "--name", "stadeum-ops-handover", "ops", "hand-over", "sha256:old"]);
  });
});
