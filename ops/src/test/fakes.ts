import type { ServiceDef, Stack } from "../compose.js";
import type { ImageRef, OpsEvent, OpsSettings, OpsStatus, Phase, Snapshot } from "../contract.js";
import type { Deps } from "../deps.js";
import type { ResticApi } from "../restic.js";
import type { StadeumApi } from "../stadeum.js";
import type { DrainView, StrutApi, StrutHealth } from "../strut.js";

/** A box: what each container runs, what each tag names here, and what each channel has. */
export class FakeStack implements Stack {
  self = "ops";
  envFiles: string[] = [];
  /** service → image ID its container runs */
  containers = new Map<string, string>();
  /** reference → image ID it names on this box */
  tags = new Map<string, string>();
  /** reference → image ID its channel has */
  registry = new Map<string, string>();
  /** image IDs that do not come up healthy */
  unhealthy = new Set<string>();
  calls: string[] = [];

  constructor(public defs: ServiceDef[]) {}

  static standard(): FakeStack {
    const s = new FakeStack([
      svc("caddy", "caddy:2.11.8-alpine"),
      svc("neo4j", "neo4j:5.26.32", { stopForBackup: true }),
      svc("redis", "redis:7.4.2-alpine", { stopForBackup: true }),
      svc("bifrost", "ghcr.io/stakwork/stakgraph-gateway:v0.4.396", { stopForBackup: true }),
      svc("strut-browser", "ghcr.io/stakwork/strut-browser:stable", { group: "strut" }),
      svc("strut", "ghcr.io/stakwork/strut:stable", { group: "strut", stopForBackup: true }),
      svc("stadeum-ui", "ghcr.io/stakwork/stadeum-ui:stable", { group: "stadeum", stopForBackup: true }),
      svc("ops", "ghcr.io/stakwork/stadeum-ops:stable", { group: "stadeum" }),
    ]);
    for (const d of s.defs) {
      const id = `sha256:${d.name}-1`;
      s.containers.set(d.name, id);
      s.tags.set(d.image, id);
      s.registry.set(d.image, id);
    }
    return s;
  }

  /** Move a channel to a new image. */
  publish(service: string, id: string) {
    this.registry.set(this.def(service).image, id);
  }

  def(name: string): ServiceDef {
    const d = this.defs.find((x) => x.name === name);
    if (!d) throw new Error(`no service ${name}`);
    return d;
  }

  async services() {
    return this.defs;
  }
  async running(service: string) {
    return this.containers.get(service);
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
  async up(services: string[], opts: { start?: boolean } = {}) {
    this.calls.push(`up${opts.start ? " --no-recreate" : ""} ${services.join(" ")}`);
    if (opts.start) return;
    for (const s of services) {
      const id = this.tags.get(this.def(s).image);
      if (id) this.containers.set(s, id);
    }
    const bad = services.filter((s) => this.unhealthy.has(this.containers.get(s) ?? ""));
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
}

export function svc(name: string, image: string, opts: Partial<ServiceDef> = {}): ServiceDef {
  return { name, image, built: false, stopForBackup: false, ...opts };
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
