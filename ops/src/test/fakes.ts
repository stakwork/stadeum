import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseServices, type Container, type ServiceDef, type Stack } from "../compose.js";
import type { ImageRef, OpsEvent, OpsSettings, OpsStatus, Phase, Snapshot } from "../contract.js";
import type { Deps } from "../deps.js";
import type { ResticApi } from "../restic.js";
import type { StadeumApi } from "../stadeum.js";
import type { DrainView, StrutApi, StrutHealth } from "../strut.js";
import { writeFiles, type Files } from "../files.js";
import { Ops } from "../ops.js";

/** A compose service as the fake's stack files have it (compose's resolved JSON, which is YAML). */
export interface FakeService {
  image: string;
  labels?: Record<string, string>;
  restart?: string;
  environment?: Record<string, string>;
  /** Bind mounts, relative to the stack directory as compose resolves them. */
  volumes?: Array<{ type: "bind"; source: string; target: string }>;
}

const hashOf = (s: unknown) => createHash("sha256").update(JSON.stringify(s)).digest("hex");

/** A release's stack files: stadeum.yml from services, and the other files as given. */
export function releaseFiles(services: Record<string, FakeService>, others: Record<string, string> = {}): Files {
  const files: Files = new Map([["stadeum.yml", Buffer.from(JSON.stringify({ services }, null, 2))]]);
  for (const [p, c] of Object.entries(others)) files.set(p, Buffer.from(c));
  return files;
}

/** The standard stack as stack files: release 1. */
export function standardServices(): Record<string, FakeService> {
  const always = { restart: "unless-stopped" };
  return {
    caddy: { ...always, image: "caddy:2.11.8-alpine", volumes: [{ type: "bind", source: "./caddy/Caddyfile", target: "/etc/caddy/Caddyfile" }] },
    neo4j: { ...always, image: "neo4j:5.26.32", labels: { "stadeum.ops.backup": "stop", "stadeum.ops.upgrade": "confirm" } },
    redis: { ...always, image: "redis:7.4.2-alpine", labels: { "stadeum.ops.backup": "stop" } },
    bifrost: { ...always, image: "ghcr.io/stakwork/stakgraph-gateway:v0.4.396", labels: { "stadeum.ops.backup": "stop" } },
    "strut-browser": { ...always, image: "ghcr.io/stakwork/strut-browser:stable", labels: { "stadeum.ops.update": "strut" } },
    strut: { ...always, image: "ghcr.io/stakwork/strut:stable", labels: { "stadeum.ops.update": "strut", "stadeum.ops.backup": "stop" } },
    bootstrap: { restart: "no", image: "node:22.20.0-alpine", volumes: [{ type: "bind", source: "./bootstrap", target: "/bootstrap" }] },
    "stadeum-ui": { ...always, image: "ghcr.io/stakwork/stadeum-ui:stable", labels: { "stadeum.ops.update": "stadeum", "stadeum.ops.backup": "stop" } },
    ops: { ...always, image: "ghcr.io/stakwork/stadeum-ops:stable", labels: { "stadeum.ops.update": "stadeum" } },
  };
}

export const CADDYFILE = "{$SCHEME}://{$HOST} {\n\treverse_proxy stadeum-ui:3000\n}\n";
export const BOOTSTRAP = "// the org key\n";

/**
 * A box: what each container runs, what each tag names here, and what each
 * channel has. Without stack files (the default) its services are `defs`.
 * `onFiles()` gives it a stack directory holding release 1, which ops-1
 * carries; its services are then what stadeum.yml there says, read as
 * compose's resolved JSON, with bind sources resolved against the
 * directory as compose does (--project-directory).
 */
export class FakeStack implements Stack {
  self = "ops";
  envFiles: string[] = [];
  dir = "";
  /** service → image ID its container runs */
  containers = new Map<string, string>();
  /** service → the config hash its container was made with */
  hashesRun = new Map<string, string>();
  /** reference → image ID it names on this box */
  tags = new Map<string, string>();
  /** reference → image ID its channel (or registry) has */
  registry = new Map<string, string>();
  /** ops image ID → the stack files it carries */
  releases = new Map<string, Files>();
  /** image IDs that do not come up healthy */
  unhealthy = new Set<string>();
  /** A service that does not come up on these files (a broken Caddyfile). */
  brokenWhen: (service: string, dir: string) => boolean = () => false;
  handover = false;
  calls: string[] = [];

  constructor(public defs: ServiceDef[]) {}

  static standard(): FakeStack {
    const s = new FakeStack(parseServices({ services: standardServices() }).map((d) => ({ ...d, binds: [] })));
    for (const d of s.defs) {
      const id = `sha256:${d.name}-1`;
      if (!d.oneShot) s.containers.set(d.name, id);
      s.tags.set(d.image, id);
      s.registry.set(d.image, id);
    }
    return s;
  }

  /** The box on stack files: release 1 in a directory of its own, the box's local.yml beside it, deployed. */
  static onFiles(): FakeStack {
    const s = FakeStack.standard();
    s.dir = mkdtempSync(join(tmpdir(), "ops-box-"));
    const r1 = releaseFiles(standardServices(), { "caddy/Caddyfile": CADDYFILE, "bootstrap/org-identity.mjs": BOOTSTRAP });
    writeFiles(s.dir, r1);
    writeFileSync(join(s.dir, "local.yml"), "services: {}  # the box's own\n");
    s.releases.set("sha256:ops-1", r1);
    for (const [name, h] of s.hashesOf(s.dir)) if (s.containers.has(name)) s.hashesRun.set(name, h);
    return s;
  }

  private config(dir: string): Record<string, FakeService> {
    return (JSON.parse(readFileSync(join(dir, "stadeum.yml"), "utf8")) as { services: Record<string, FakeService> }).services;
  }

  private parse(dir: string): ServiceDef[] {
    const services = this.config(dir);
    for (const s of Object.values(services)) for (const v of s.volumes ?? []) v.source = join(this.dir, v.source);
    return parseServices({ services });
  }

  private hashesOf(dir: string): Map<string, string> {
    return new Map(Object.entries(this.config(dir)).map(([name, svc]) => [name, hashOf(svc)]));
  }

  /** The box's services now. */
  current(): ServiceDef[] {
    return this.dir && existsSync(join(this.dir, "stadeum.yml")) ? this.parse(this.dir) : this.defs;
  }

  /** Move a channel to a new image. */
  publish(service: string, id: string) {
    this.registry.set(this.def(service).image, id);
  }

  /** Publish a release: ops's new image carries `files`, and its channel has it (and stadeum-ui's, when given). */
  release(opsId: string, files: Files, uiId?: string) {
    this.releases.set(opsId, files);
    this.publish("ops", opsId);
    if (uiId) this.publish("stadeum-ui", uiId);
  }

  def(name: string): ServiceDef {
    const d = this.current().find((x) => x.name === name);
    if (!d) throw new Error(`no service ${name}`);
    return d;
  }

  read(path: string): string | null {
    const p = join(this.dir, path);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  async services(release?: string) {
    if (release) {
      if (!existsSync(join(release, "stadeum.yml"))) return this.current();
      if (JSON.parse(readFileSync(join(release, "stadeum.yml"), "utf8")).services === undefined) throw new Error("services must be a mapping");
      return this.parse(release);
    }
    return this.current();
  }
  async hashes(release?: string) {
    return this.dir ? this.hashesOf(release ?? this.dir) : new Map<string, string>();
  }
  async running(service: string) {
    return this.containers.get(service);
  }
  async container(service: string): Promise<Container | undefined> {
    const image = this.containers.get(service);
    const hash = this.hashesRun.get(service);
    return image ? { image, ...(hash ? { hash } : {}) } : undefined;
  }
  async imageId(ref: string) {
    return this.tags.get(ref);
  }
  async describe(id: string): Promise<ImageRef> {
    return { id, revision: id.replace(/^sha256:/, "") };
  }
  async pull(services: string[]) {
    this.calls.push(`pull ${services.join(" ")}`);
    for (const s of services) {
      const ref = this.def(s).image;
      const id = this.registry.get(ref);
      if (id) this.tags.set(ref, id);
    }
  }
  async pullImages(refs: string[]) {
    this.calls.push(`pull-images ${refs.join(" ")}`);
    for (const ref of refs) {
      const id = this.registry.get(ref);
      if (!id) throw new Error(`${ref}: not found`);
      this.tags.set(ref, id);
    }
  }
  async up(services: string[], opts: { start?: boolean; recreate?: boolean } = {}) {
    this.calls.push(`up${opts.start ? " --no-recreate" : ""}${opts.recreate ? " --recreate" : ""} ${services.join(" ")}`);
    if (opts.start) return;
    const defs = this.current();
    const hashes = this.dir ? this.hashesOf(this.dir) : new Map<string, string>();
    if (opts.recreate) {
      for (const name of [...this.containers.keys()]) {
        if (!defs.some((d) => d.name === name)) {
          this.containers.delete(name);
          this.hashesRun.delete(name);
        }
      }
    }
    for (const s of services) {
      const id = this.tags.get(this.def(s).image);
      if (id) this.containers.set(s, id);
      const h = hashes.get(s);
      if (h) this.hashesRun.set(s, h);
    }
    const bad = services.filter((s) => this.unhealthy.has(this.containers.get(s) ?? "") || this.brokenWhen(s, this.dir));
    if (bad.length) throw new Error(`container ${bad.join(", ")} is unhealthy`);
  }
  async stop(services: string[]) {
    this.calls.push(`stop ${services.join(" ")}`);
  }
  async tag(id: string, ref: string) {
    this.calls.push(`tag ${id} ${ref}`);
    this.tags.set(ref, id);
  }
  async spawnSelf(args: string[]) {
    this.calls.push(`spawn ${args.join(" ")}`);
  }
  async handingOver() {
    return this.handover;
  }
  async releaseOf(image: string) {
    return this.releases.get(image) ?? null;
  }
}

export function svc(name: string, image: string, opts: Partial<ServiceDef> = {}): ServiceDef {
  return { name, image, built: false, stopForBackup: false, oneShot: false, confirm: false, binds: [], ...opts };
}

/** strut's drain: idle after `busyPolls` reads of it. */
export class FakeStrut implements StrutApi {
  calls: string[] = [];
  busyPolls = 0;
  down = false;
  healthy = true;
  private polls = 0;

  private view(): DrainView {
    const idle = this.polls >= this.busyPolls;
    return { draining: true, idle, active: { runs: idle ? 0 : 2, chats: 0 }, runs: [] };
  }
  async health(): Promise<StrutHealth> {
    if (this.down) throw new Error("connect ECONNREFUSED");
    // Unhealthy: the keyless answer, as from a strut that does not hold the key.
    return this.healthy ? { ok: true, workspace: { backend: "neo4j" } } : { ok: true };
  }
  async drain(reason: string, minutes: number) {
    if (this.down) throw new Error("connect ECONNREFUSED");
    this.calls.push(`drain ${minutes} ${reason}`);
    this.polls = 0;
    return this.view();
  }
  async drainView() {
    this.polls++;
    return this.view();
  }
  async lift() {
    this.calls.push("lift");
  }
}

export class FakeStadeum implements StadeumApi {
  statuses: OpsStatus[] = [];
  events: OpsEvent[] = [];
  down = false;
  constructor(public current: OpsSettings = settings()) {}
  async settings() {
    if (this.down) throw new Error("stadeum-ui is down");
    return this.current;
  }
  async status(s: OpsStatus) {
    if (this.down) throw new Error("stadeum-ui is down");
    this.statuses.push(structuredClone(s));
  }
  async record(e: OpsEvent) {
    if (this.down) throw new Error("stadeum-ui is down");
    this.events.push(e);
  }
}

export function settings(patch: Partial<OpsSettings> = {}): OpsSettings {
  return {
    window: { start: "03:00", end: "05:00", timeZone: "UTC" },
    drainMinutes: 30,
    updates: { enabled: true },
    backups: null,
    requests: [],
    lastCycle: null,
    failedImages: [],
    ...patch,
  };
}

export class FakeRestic implements ResticApi {
  calls: string[] = [];
  snaps: Snapshot[] = [];
  /** The snapshot's directory listing under /volumes. */
  volumes: string[] = [];
  env: string | null = null;
  failBackup = false;
  failOpen = false;
  repoExists = true;
  async ensureRepo() {
    this.calls.push("open");
    if (this.failOpen) throw new Error("wrong password or no key found");
    if (this.repoExists) return false;
    this.repoExists = true;
    return true;
  }
  async backup(paths: string[], host: string) {
    this.calls.push(`backup ${host} ${paths.join(" ")}`);
    if (this.failBackup) throw new Error("bucket not found");
    const s = { id: `snap${this.snaps.length + 1}aaaaaaaa`, time: new Date().toISOString(), added: 2_500_000 };
    this.snaps.unshift(s);
    return s;
  }
  async forget() {
    this.calls.push("forget");
  }
  async snapshots() {
    return this.snaps;
  }
  async list() {
    return this.volumes;
  }
  async restore(snapshot: string, paths: string[]) {
    this.calls.push(`restore ${snapshot} ${paths.join(" ")}`);
  }
  async dump(_snapshot: string, path: string) {
    if (this.env === null) throw new Error(`no ${path}`);
    return this.env;
  }
}

/** Deps on a clock that moves only when ops sleeps. */
export function deps(stack: Stack, strut: StrutApi, start = new Date("2026-11-05T03:10:00Z")) {
  let t = start.getTime();
  const log: string[] = [];
  const phases: Array<[Phase, string | undefined]> = [];
  const d: Deps = {
    stack,
    strut,
    log: (m) => log.push(m),
    now: () => new Date(t),
    sleep: async (ms) => {
      t += ms;
    },
    phase: async (p, detail) => {
      phases.push([p, detail]);
    },
  };
  return { d, log, phases, advance: (ms: number) => (t += ms) };
}

/** ops on a box with stack files, at `now`. */
export function loop(now = "2026-11-05T12:00:00Z") {
  const stack = FakeStack.onFiles();
  const strut = new FakeStrut();
  const stadeum = new FakeStadeum();
  const restic = new FakeRestic();
  let t = new Date(now).getTime();
  const log: string[] = [];
  const ops = new Ops({
    stack,
    strut,
    stadeum,
    restic: () => restic,
    log: (m) => log.push(m),
    now: () => new Date(t),
    sleep: async (ms) => {
      t += ms;
    },
    version: "abc1234",
    host: "stadeum",
    paths: { volumes: "/volumes", envDir: join(mkdtempSync(join(tmpdir(), "ops-loop-")), "env") },
  });
  return { ops, stack, strut, stadeum, restic, log, at: (iso: string) => (t = new Date(iso).getTime()) };
}

