import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

import type { ImageRef } from "./contract.js";
import { CommandError, must, type Exec } from "./exec.js";
import { readFiles, RELEASE_STACK, type Files } from "./files.js";

/**
 * How ops drives the containers: `docker compose`, run here against the
 * very files and env file the stack was started with, so an update is the
 * same `compose pull` + `compose up` a person would type. Compose already
 * knows how to recreate a container with its networks, volumes and
 * health; ops adds none of that.
 *
 * Compose hands the Docker daemon host paths (`./caddy/Caddyfile` becomes
 * `/opt/stadeum/stack/caddy/Caddyfile`), so it must read the files at their
 * host paths. ops mounts the box's directory at /stadeum and, at start,
 * links its host path to it. Which project, files and env file: compose's
 * own labels on ops's container (`com.docker.compose.project…`), and the
 * box's own `stack/local.yml` when there is one.
 */

/** Where the box's directory is mounted (stack/stadeum.yml, the `ops` service): `stack/` and `.env`. On a laptop, the checkout. */
export const BOX = "/stadeum";

/** The label that puts a service in an update group: ops moves the group together. */
export const UPDATE_LABEL = "stadeum.ops.update";
/** The label that stops a service while the snapshot is taken: its files would tear mid-write. */
export const BACKUP_LABEL = "stadeum.ops.backup";
/**
 * `stadeum.ops.upgrade: confirm`: a release that changes the service's
 * image waits until an admin confirms it, and a backup is taken first.
 * Neo4j's: it cannot open a store a newer version wrote.
 */
export const UPGRADE_LABEL = "stadeum.ops.upgrade";
/** The box's own compose override, beside stadeum.yml: applied when it is there, and never written by ops. */
export const LOCAL_FILE = "local.yml";

export interface ServiceDef {
  name: string;
  image: string;
  /** Has a `build:` (stack/dev.yml): made on this box, never pulled. */
  built: boolean;
  group?: string;
  stopForBackup: boolean;
  /** `restart: "no"`: a one-shot (bootstrap). An update never starts it. */
  oneShot: boolean;
  /** Its image moves only when an admin confirms it (UPGRADE_LABEL). */
  confirm: boolean;
  /** The host paths bind-mounted into it: a release that changes one of these files recreates it. */
  binds: string[];
}

/** What a service's container runs. */
export interface Container {
  /** The image ID it was made from. */
  image: string;
  /** Compose's hash of the config it was made with (`com.docker.compose.config-hash`). */
  hash?: string;
}

/** The containers, as ops may touch them. A fake stands in for it in tests. */
export interface Stack {
  /** ops's own service name. */
  readonly self: string;
  /** The env files compose reads, at paths readable here. */
  readonly envFiles: string[];
  /** The stack directory (`stadeum.yml`'s), at a path readable here: where a release's files go. */
  readonly dir: string;
  /**
   * The compose file's services, interpolated with the env file, by name.
   * `release`: a directory holding a release's stack files, read in place
   * of the box's copies (the box's `local.yml` still applies).
   */
  services(release?: string): Promise<ServiceDef[]>;
  /** Compose's hash of each service's config, as `up` will compare it with the container's. */
  hashes(release?: string): Promise<Map<string, string>>;
  /** The image ID the service's container was made from; undefined when it has none. */
  running(service: string): Promise<string | undefined>;
  container(service: string): Promise<Container | undefined>;
  /** The image ID a reference names on this box; undefined when it is not here. */
  imageId(ref: string): Promise<string | undefined>;
  describe(id: string): Promise<ImageRef>;
  pull(services: string[]): Promise<void>;
  /** Pull image references, whatever service names them. */
  pullImages(refs: string[]): Promise<void>;
  /**
   * `up -d --no-deps --wait`: recreate what changed and wait until each is
   * healthy (or running, without a healthcheck). `start`: only start what
   * is stopped, recreating nothing. `recreate`: recreate each, changed or
   * not (a file it mounts changed), and remove the containers of services
   * the files no longer have.
   */
  up(services: string[], opts?: { start?: boolean; recreate?: boolean }): Promise<void>;
  stop(services: string[]): Promise<void>;
  tag(id: string, ref: string): Promise<void>;
  /** A one-off ops container (`compose run -d --rm`) running `args`: the hand-over that applies a release. */
  spawnSelf(args: string[]): Promise<void>;
  /** Whether that one-off is running. */
  handingOver(): Promise<boolean>;
  /** The stack files an ops image carries: its release's. Null when it carries none (an image older than releases). */
  releaseOf(image: string): Promise<Files | null>;
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
  const source = mounts.find((m) => m.Destination === BOX)?.Source;
  if (!source) throw new Error(`ops has no ${BOX} mount: the box's directory must be mounted there (stack/stadeum.yml)`);
  linkHostPath(boxPath(source, project.files));
  return project;
}

/**
 * The box's directory as compose names it. The daemon may report the
 * mount's source under a prefix of its own (Docker Desktop:
 * `/host_mnt/Users/…` for `/Users/…`), so take the directory above the
 * compose files that the source ends with.
 */
export function boxPath(source: string, files: string[]): string {
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
  if (hostPath === BOX || existsSync(hostPath)) return;
  mkdirSync(dirname(hostPath), { recursive: true });
  symlinkSync(BOX, hostPath);
}

interface ComposeService {
  image?: string;
  build?: unknown;
  labels?: Record<string, string>;
  restart?: string;
  volumes?: Array<{ type?: string; source?: string }>;
}

export interface ComposeConfig {
  services: Record<string, ComposeService>;
}

export function parseServices(config: ComposeConfig): ServiceDef[] {
  return Object.entries(config.services).map(([name, s]) => ({
    name,
    image: s.image ?? "",
    built: s.build !== undefined,
    ...(s.labels?.[UPDATE_LABEL] ? { group: s.labels[UPDATE_LABEL] } : {}),
    stopForBackup: s.labels?.[BACKUP_LABEL] === "stop",
    oneShot: !s.restart || s.restart === "no",
    confirm: s.labels?.[UPGRADE_LABEL] === "confirm",
    binds: (s.volumes ?? []).filter((v) => v.type === "bind" && v.source).map((v) => v.source!),
  }));
}

/** `config --hash '*'`: a `service hash` line each. */
export function parseHashes(out: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [service, hash] = line.trim().split(/\s+/);
    if (service && hash) hashes.set(service, hash);
  }
  return hashes;
}

export class ComposeStack implements Stack {
  readonly self: string;
  readonly envFiles: string[];
  readonly dir: string;

  constructor(
    private readonly project: Project,
    private readonly exec: Exec,
  ) {
    this.self = project.self;
    this.envFiles = project.envFiles;
    this.dir = dirname(project.files[0] ?? join(project.workingDir, "stadeum.yml"));
  }

  /**
   * The compose files: those the stack was started with, then the box's
   * local.yml when it is there. With `release`, each of the box's files the
   * release also has is read from the release instead.
   */
  files(release?: string): string[] {
    const local = join(this.dir, LOCAL_FILE);
    const files = [...this.project.files.filter((f) => f !== local), ...(existsSync(local) ? [local] : [])];
    if (!release) return files;
    return files.map((f) => {
      const rel = relative(this.dir, f);
      return f !== local && !rel.startsWith("..") && existsSync(join(release, rel)) ? join(release, rel) : f;
    });
  }

  /** Run compose; a failure says which step and compose's own last line, not the whole command. */
  private async compose(args: string[], what = `compose ${args[0]}`, release?: string): Promise<string> {
    try {
      return await this.composeRaw(args, release);
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      const lines = (err.result.stderr || err.result.stdout).trim().split("\n").map((l) => l.trim()).filter(Boolean);
      throw new Error(`${what}: ${(lines.at(-1) ?? `exited ${err.result.code}`).slice(0, 300)}`);
    }
  }

  private composeRaw(args: string[], release?: string): Promise<string> {
    const p = this.project;
    return must(this.exec, "docker", [
      "compose",
      "-p",
      p.name,
      "--project-directory",
      p.workingDir,
      ...this.files(release).flatMap((f) => ["-f", f]),
      ...p.envFiles.flatMap((f) => ["--env-file", f]),
      ...args,
    ]);
  }

  async services(release?: string): Promise<ServiceDef[]> {
    return parseServices(JSON.parse(await this.compose(["config", "--format", "json"], "reading the compose files", release)) as ComposeConfig);
  }

  async hashes(release?: string): Promise<Map<string, string>> {
    return parseHashes(await this.compose(["config", "--hash", "*"], "hashing the services", release));
  }

  async running(service: string): Promise<string | undefined> {
    return (await this.container(service))?.image;
  }

  async container(service: string): Promise<Container | undefined> {
    const ids = (await this.compose(["ps", "-a", "-q", service])).trim().split("\n").filter(Boolean);
    if (!ids[0]) return undefined;
    const out = await must(this.exec, "docker", ["inspect", ids[0], "--format", '{{.Image}}\t{{index .Config.Labels "com.docker.compose.config-hash"}}']);
    const [image, hash] = out.trim().split("\t");
    return image ? { image, ...(hash ? { hash } : {}) } : undefined;
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

  async pullImages(refs: string[]): Promise<void> {
    for (const ref of refs) {
      try {
        await must(this.exec, "docker", ["pull", "--quiet", ref]);
      } catch (err) {
        throw new Error(`pulling ${ref}: ${err instanceof CommandError ? (err.result.stderr || err.result.stdout).trim().split("\n").at(-1) : String(err)}`);
      }
    }
  }

  async up(services: string[], opts: { start?: boolean; recreate?: boolean } = {}): Promise<void> {
    if (!services.length) return;
    await this.compose([
      "up",
      "-d",
      "--no-deps",
      "--no-build",
      "--pull",
      "never",
      ...(opts.start ? ["--no-recreate"] : []),
      ...(opts.recreate ? ["--force-recreate", "--remove-orphans"] : []),
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

  private get handover() {
    return `${this.project.name}-ops-handover`;
  }

  async spawnSelf(args: string[]): Promise<void> {
    await this.compose(["run", "-d", "--rm", "--no-deps", "--name", this.handover, this.self, ...args]);
  }

  async handingOver(): Promise<boolean> {
    const out = await must(this.exec, "docker", ["ps", "-q", "--filter", `name=^${this.handover}$`]);
    return out.trim() !== "";
  }

  async releaseOf(image: string): Promise<Files | null> {
    const name = `${this.project.name}-ops-release-${Math.random().toString(36).slice(2, 10)}`;
    const dir = mkdtempSync(join(tmpdir(), "release-"));
    try {
      await must(this.exec, "docker", ["create", "--name", name, image]);
      const r = await this.exec("docker", ["cp", `${name}:${RELEASE_STACK}`, dir]);
      if (r.code !== 0) {
        if (/could not find|no such file/i.test(r.stderr)) return null;
        throw new CommandError("docker", ["cp"], r);
      }
      return readFiles(join(dir, basename(RELEASE_STACK)));
    } finally {
      await this.exec("docker", ["rm", "-f", name]);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
