import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";

import type { ImageRef } from "./contract.js";
import { CommandError, must, type Exec } from "./exec.js";

/**
 * How ops drives the containers: `docker compose`, run here against the
 * very files and env file the stack was started with, so an update is the
 * same `compose pull` + `compose up` a person would type. Compose already
 * knows how to recreate a container with its networks, volumes and
 * health; ops adds none of that.
 *
 * Compose hands the Docker daemon host paths (`./caddy/Caddyfile` becomes
 * `<checkout>/stack/caddy/Caddyfile`), so it must read the files at their
 * host paths. ops mounts the checkout at /stadeum and, at start, links its
 * host path to it. Which project, files and env file: compose's own labels
 * on ops's container (`com.docker.compose.project…`).
 */

/** Where the checkout is mounted (stack/stadeum.yml, the `ops` service). */
export const CHECKOUT = "/stadeum";

/** The label that puts a service in an update group: ops moves the group together. */
export const UPDATE_LABEL = "stadeum.ops.update";
/** The label that stops a service while the snapshot is taken: its files would tear mid-write. */
export const BACKUP_LABEL = "stadeum.ops.backup";

export interface ServiceDef {
  name: string;
  image: string;
  /** Has a `build:` (stack/dev.yml): made on this box, never pulled. */
  built: boolean;
  group?: string;
  stopForBackup: boolean;
}

/** The containers, as ops may touch them. A fake stands in for it in tests. */
export interface Stack {
  /** ops's own service name. */
  readonly self: string;
  /** The env files compose reads, at paths readable here. */
  readonly envFiles: string[];
  /** The compose file's services, interpolated with the env file, by name. */
  services(): Promise<ServiceDef[]>;
  /** The image ID the service's container was made from; undefined when it has none. */
  running(service: string): Promise<string | undefined>;
  /** The image ID a reference names on this box; undefined when it is not here. */
  imageId(ref: string): Promise<string | undefined>;
  describe(id: string): Promise<ImageRef>;
  pull(services: string[]): Promise<void>;
  /**
   * `up -d --no-deps --wait`: recreate what changed and wait until each is
   * healthy (or running, without a healthcheck). `start`: only start what
   * is stopped, recreating nothing.
   */
  up(services: string[], opts?: { start?: boolean }): Promise<void>;
  stop(services: string[]): Promise<void>;
  tag(id: string, ref: string): Promise<void>;
  /** A one-off ops container (`compose run -d --rm`) running `args`: the hand-over when ops updates itself. */
  spawnSelf(args: string[]): Promise<void>;
}

export interface Project {
  name: string;
  workingDir: string;
  files: string[];
  envFiles: string[];
  self: string;
}

const UP_TIMEOUT_S = 600;
const STOP_TIMEOUT_S = 120;

/** Read the project from ops's own container, and make its host paths readable here. */
export async function discover(exec: Exec): Promise<Project> {
  const out = await must(exec, "docker", ["inspect", hostname(), "--format", "{{json .Config.Labels}}\t{{json .Mounts}}"]);
  const [labelsJson = "{}", mountsJson = "[]"] = out.trim().split("\t");
  const labels = JSON.parse(labelsJson) as Record<string, string>;
  const mounts = JSON.parse(mountsJson) as Array<{ Source: string; Destination: string }>;
  const project = parseProject(labels);
  const source = mounts.find((m) => m.Destination === CHECKOUT)?.Source;
  if (!source) throw new Error(`ops has no ${CHECKOUT} mount: the checkout must be mounted there (stack/stadeum.yml)`);
  linkHostPath(checkoutPath(source, project.files));
  return project;
}

/**
 * The checkout's path as compose names it. The daemon may report the
 * mount's source under a prefix of its own (Docker Desktop:
 * `/host_mnt/Users/…` for `/Users/…`), so take the directory above the
 * compose files that the source ends with.
 */
export function checkoutPath(source: string, files: string[]): string {
  for (const file of files) {
    for (let dir = dirname(file); dir !== "/" && dir !== "."; dir = dirname(dir)) {
      if (source === dir || source.endsWith(dir)) return dir;
    }
  }
  return source;
}

export function parseProject(labels: Record<string, string>): Project {
  const name = labels["com.docker.compose.project"];
  const workingDir = labels["com.docker.compose.project.working_dir"];
  const files = labels["com.docker.compose.project.config_files"];
  const self = labels["com.docker.compose.service"];
  if (!name || !workingDir || !files || !self) {
    throw new Error("ops is not running under docker compose: its container has no compose project labels");
  }
  const list = (s: string | undefined) => (s ? s.split(",").map((f) => f.trim()).filter(Boolean) : []);
  return { name, workingDir, files: list(files), envFiles: list(labels["com.docker.compose.project.environment_file"]), self };
}

function linkHostPath(hostPath: string) {
  if (hostPath === CHECKOUT || existsSync(hostPath)) return;
  mkdirSync(dirname(hostPath), { recursive: true });
  symlinkSync(CHECKOUT, hostPath);
}

interface ComposeConfig {
  services: Record<string, { image?: string; build?: unknown; labels?: Record<string, string> }>;
}

export function parseServices(config: ComposeConfig): ServiceDef[] {
  return Object.entries(config.services).map(([name, s]) => ({
    name,
    image: s.image ?? "",
    built: s.build !== undefined,
    ...(s.labels?.[UPDATE_LABEL] ? { group: s.labels[UPDATE_LABEL] } : {}),
    stopForBackup: s.labels?.[BACKUP_LABEL] === "stop",
  }));
}

export class ComposeStack implements Stack {
  readonly self: string;
  readonly envFiles: string[];

  constructor(
    private readonly project: Project,
    private readonly exec: Exec,
  ) {
    this.self = project.self;
    this.envFiles = project.envFiles;
  }

  /** Run compose; a failure says which step and compose's own last line, not the whole command. */
  private async compose(args: string[], what = `compose ${args[0]}`): Promise<string> {
    try {
      return await this.composeRaw(args);
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      const lines = (err.result.stderr || err.result.stdout).trim().split("\n").map((l) => l.trim()).filter(Boolean);
      throw new Error(`${what}: ${(lines.at(-1) ?? `exited ${err.result.code}`).slice(0, 300)}`);
    }
  }

  private composeRaw(args: string[]): Promise<string> {
    const p = this.project;
    return must(this.exec, "docker", [
      "compose",
      "-p",
      p.name,
      "--project-directory",
      p.workingDir,
      ...p.files.flatMap((f) => ["-f", f]),
      ...p.envFiles.flatMap((f) => ["--env-file", f]),
      ...args,
    ]);
  }

  async services(): Promise<ServiceDef[]> {
    return parseServices(JSON.parse(await this.compose(["config", "--format", "json"])) as ComposeConfig);
  }

  async running(service: string): Promise<string | undefined> {
    const ids = (await this.compose(["ps", "-a", "-q", service])).trim().split("\n").filter(Boolean);
    if (!ids[0]) return undefined;
    return (await must(this.exec, "docker", ["inspect", ids[0], "--format", "{{.Image}}"])).trim() || undefined;
  }

  async imageId(ref: string): Promise<string | undefined> {
    const r = await this.exec("docker", ["image", "inspect", ref, "--format", "{{.Id}}"]);
    return r.code === 0 ? r.stdout.trim() || undefined : undefined;
  }

  async describe(id: string): Promise<ImageRef> {
    const out = await must(this.exec, "docker", ["image", "inspect", id, "--format", "{{json .Config.Labels}}\t{{.Created}}"]);
    const [labels = "null", created] = out.trim().split("\t");
    const revision = (JSON.parse(labels) as Record<string, string> | null)?.["org.opencontainers.image.revision"];
    return { id, ...(revision ? { revision } : {}), ...(created ? { created } : {}) };
  }

  async pull(services: string[]): Promise<void> {
    if (services.length) await this.compose(["pull", "--quiet", ...services], `pulling ${services.join(", ")}`);
  }

  async up(services: string[], opts: { start?: boolean } = {}): Promise<void> {
    if (!services.length) return;
    await this.compose([
      "up",
      "-d",
      "--no-deps",
      "--no-build",
      "--pull",
      "never",
      ...(opts.start ? ["--no-recreate"] : []),
      "--wait",
      "--wait-timeout",
      String(UP_TIMEOUT_S),
      ...services,
    ], `${opts.start ? "starting" : "recreating"} ${services.join(", ")}`);
  }

  async stop(services: string[]): Promise<void> {
    if (services.length) await this.compose(["stop", "--timeout", String(STOP_TIMEOUT_S), ...services], `stopping ${services.join(", ")}`);
  }

  async tag(id: string, ref: string): Promise<void> {
    await must(this.exec, "docker", ["tag", id, ref]);
  }

  async spawnSelf(args: string[]): Promise<void> {
    await this.compose(["run", "-d", "--rm", "--no-deps", "--name", `${this.project.name}-ops-handover`, this.self, ...args]);
  }
}
