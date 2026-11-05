import { describe, expect, it } from "vitest";

import { checkoutPath, ComposeStack, parseProject, parseServices } from "./compose.js";
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

  it("finds the checkout at the path compose names it, under any prefix the daemon adds", () => {
    const files = ["/Users/ada/stadeum/stack/stadeum.yml", "/Users/ada/stadeum/stack/dev.yml"];
    expect(checkoutPath("/host_mnt/Users/ada/stadeum", files)).toBe("/Users/ada/stadeum");
    expect(checkoutPath("/srv/stadeum", ["/srv/stadeum/stack/stadeum.yml"])).toBe("/srv/stadeum");
    expect(checkoutPath("/elsewhere", ["/srv/stadeum/stack/stadeum.yml"])).toBe("/elsewhere");
  });

  it("refuses a container compose did not start", () => {
    expect(() => parseProject({})).toThrow(/not running under docker compose/);
  });

  it("reads the update groups and the services stopped for a backup from the labels", () => {
    const services = parseServices({
      services: {
        neo4j: { image: "neo4j:5.26.32", labels: { "stadeum.ops.backup": "stop" } },
        strut: { image: "ghcr.io/stakwork/strut:stable", labels: { "stadeum.ops.update": "strut", "stadeum.ops.backup": "stop" } },
        "stadeum-ui": { image: "stadeum-ui:dev", build: { context: "../ui" }, labels: { "stadeum.ops.update": "stadeum" } },
        caddy: { image: "caddy:2.11.8-alpine" },
      },
    });
    expect(services).toEqual([
      { name: "neo4j", image: "neo4j:5.26.32", built: false, stopForBackup: true },
      { name: "strut", image: "ghcr.io/stakwork/strut:stable", built: false, group: "strut", stopForBackup: true },
      { name: "stadeum-ui", image: "stadeum-ui:dev", built: true, group: "stadeum", stopForBackup: false },
      { name: "caddy", image: "caddy:2.11.8-alpine", built: false, stopForBackup: false },
    ]);
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
    expect(calls[0]).toEqual([...base, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "600", "strut"]);
    expect(calls[1]).toContain("--no-recreate");
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

  it("hands over to a one-off ops container", async () => {
    const { s, calls } = stack();
    await s.spawnSelf(["hand-over", "sha256:old"]);
    expect(calls[0]).toEqual([...base, "run", "-d", "--rm", "--no-deps", "--name", "stadeum-ops-handover", "ops", "hand-over", "sha256:old"]);
  });
});
