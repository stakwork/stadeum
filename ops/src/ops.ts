import type { ServiceDef, Stack } from "./compose.js";
import type { Destination, OpsEvent, OpsSettings, OpsStatus, ServiceImage } from "./contract.js";
import { backup } from "./backup.js";
import { errorText, type Deps } from "./deps.js";
import type { ResticApi } from "./restic.js";
import { Outbox, type StadeumApi } from "./stadeum.js";
import type { StrutApi } from "./strut.js";
import { checkGroup, handOver, isNewer, selfDef, updateGroup, updateGroups, type Check, type Group } from "./update.js";
import { currentWindow } from "./window.js";

/**
 * The loop. Every tick ops reads its settings from stadeum-ui, does what
 * an admin asked for (check, update or back up now), and once in each
 * day's window runs the daily pass: the backup, then the updates (held
 * when tonight's backup failed), then ops's own update last.
 */

export interface OpsDeps {
  stack: Stack;
  strut: StrutApi;
  stadeum: StadeumApi;
  restic: (dest: Destination) => ResticApi;
  log: (msg: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** ops's own revision. */
  version: string;
  /** restic's `--host`: the compose project. */
  host: string;
  /** Where the volumes are mounted and the env file is copied (backup.ts); tests pass their own. */
  paths?: { volumes: string; envDir: string };
}

interface Checked {
  groups: Array<{ group: Group; checks: Check[] }>;
  self?: Check;
}

export class Ops {
  readonly deps: Deps;
  private status: OpsStatus;
  private settings: OpsSettings | null = null;
  private lastCycle: string | null = null;
  /** Requests handled here, until stadeum-ui says it has them. */
  private handled = new Set<string>();
  private unsentDone: string[] = [];
  private readonly outbox: Outbox;
  private reportFailing = false;

  constructor(private readonly o: OpsDeps) {
    this.status = { phase: "idle", version: o.version, services: [] };
    this.outbox = new Outbox(o.stadeum, o.log);
    this.deps = { stack: o.stack, strut: o.strut, log: o.log, now: o.now, sleep: o.sleep, phase: (phase, detail) => this.report({ phase, detail }) };
  }

  /** Say what ops is doing. A stadeum-ui that does not answer (it may be restarting) gets the next one. */
  async report(patch: Partial<OpsStatus>): Promise<void> {
    const was = this.status.phase;
    this.status = { ...this.status, ...patch };
    // A detail belongs to its phase: it goes when the phase changes, unless a new one comes with it.
    if (patch.detail === undefined && patch.phase && patch.phase !== was) delete this.status.detail;
    const body: OpsStatus = { ...this.status, ...(this.unsentDone.length ? { done: [...this.unsentDone] } : {}) };
    try {
      await this.o.stadeum.status(body);
      this.unsentDone = [];
      this.reportFailing = false;
    } catch (err) {
      if (!this.reportFailing) this.o.log(`status not sent: ${errorText(err)}`);
      this.reportFailing = true;
    }
  }

  async tick(): Promise<void> {
    let settings: OpsSettings;
    try {
      settings = await this.o.stadeum.settings();
      this.settings = settings;
    } catch (err) {
      if (!this.settings) {
        this.o.log(`no settings yet: ${errorText(err)}`);
        return;
      }
      settings = this.settings;
    }
    await this.outbox.flush();
    if (!this.status.services.length) await this.refresh();

    for (const id of [...this.handled]) if (!settings.requests.some((r) => r.id === id)) this.handled.delete(id);
    const requests = settings.requests.filter((r) => !this.handled.has(r.id));
    if (requests.length) return this.answer(settings, requests);

    const window = currentWindow(this.o.now(), settings.window);
    if (window && window !== settings.lastCycle && window !== this.lastCycle) return this.daily(settings, window);
    await this.report({ phase: "idle" });
  }

  /** "Check now", "Update now", "Back up now": what was asked, once each however often it was. */
  private async answer(settings: OpsSettings, requests: OpsSettings["requests"]): Promise<void> {
    const kinds = new Set(requests.map((r) => r.kind));
    for (const r of requests) this.handled.add(r.id);
    let self: Check | null = null;
    try {
      if (kinds.has("backup")) await this.backup(settings);
      if (kinds.has("update")) self = await this.update(settings, true);
      else if (kinds.has("check")) await this.check(new Set(settings.failedImages));
    } finally {
      this.unsentDone.push(...requests.map((r) => r.id));
      await this.report({ phase: "idle" });
    }
    if (self) await handOver(this.deps, self);
  }

  private async daily(settings: OpsSettings, window: string): Promise<void> {
    this.lastCycle = window;
    this.o.log(`daily pass for the window of ${window}`);
    let self: Check | null = null;
    try {
      const backedUp = settings.backups?.enabled ? await this.backup(settings) : null;
      if (settings.updates.enabled) {
        if (backedUp?.outcome === "failed") {
          const at = this.o.now().toISOString();
          await this.outbox.record({ kind: "update", outcome: "skipped", startedAt: at, endedAt: at, detail: "Updates held back: tonight's backup failed." });
        } else {
          self = await this.update(settings, false);
        }
      }
    } finally {
      await this.report({ phase: "idle", lastCycle: window });
    }
    if (self) await handOver(this.deps, self);
  }

  /**
   * Pull every update group and compare with what runs. An image that
   * failed before keeps its tag off: the tag goes back on what runs, so a
   * person's `compose up` does not bring it back.
   */
  async check(failed: ReadonlySet<string> = new Set()): Promise<Checked> {
    await this.report({ phase: "checking" });
    const defs = await this.o.stack.services();
    const groups: Checked["groups"] = [];
    const problems: string[] = [];
    for (const group of updateGroups(defs, this.o.stack.self)) {
      try {
        groups.push({ group, checks: await checkGroup(this.o.stack, group.services) });
      } catch (err) {
        problems.push(`${group.name}: ${errorText(err)}`);
      }
    }
    let self: Check | undefined;
    const sd = selfDef(defs, this.o.stack.self);
    if (sd) {
      try {
        self = (await checkGroup(this.o.stack, [sd]))[0];
      } catch (err) {
        problems.push(`${sd.name}: ${errorText(err)}`);
      }
    }
    for (const c of [...groups.flatMap((g) => g.checks), ...(self ? [self] : [])]) {
      if (c.running && c.available && c.available !== c.running && failed.has(c.available)) await this.o.stack.tag(c.running, c.service.image);
    }
    for (const p of problems) this.o.log(`check failed: ${p}`);
    await this.refresh(defs, [...groups.flatMap((g) => g.checks), ...(self ? [self] : [])]);
    await this.report({ phase: "idle", checkedAt: this.o.now().toISOString(), ...(problems.length ? { detail: `Could not check ${problems.join("; ")}` } : {}) });
    return { groups, ...(self ? { self } : {}) };
  }

  /** Check, then move each group that has something new. Returns ops's own check when ops should hand over. */
  async update(settings: OpsSettings, force: boolean): Promise<Check | null> {
    const failed = new Set(settings.failedImages);
    const { groups, self } = await this.check(force ? new Set() : failed);
    for (const { group, checks } of groups) {
      const event = await updateGroup(this.deps, group, checks, { force, failed, drainMinutes: settings.drainMinutes });
      if (event) await this.outbox.record(event);
    }
    await this.refresh();
    if (!self || !isNewer(self) || (!force && failed.has(self.available!))) return null;
    return self;
  }

  async backup(settings: OpsSettings): Promise<OpsEvent | null> {
    if (!settings.backups) return null;
    const restic = this.o.restic(settings.backups);
    const event = await backup(this.deps, restic, {
      drainMinutes: settings.drainMinutes,
      host: this.o.host,
      envFile: this.o.stack.envFiles[0],
      ...this.o.paths,
    });
    await this.outbox.record(event);
    try {
      await this.report({ snapshots: (await restic.snapshots()).slice(0, 30) });
    } catch (err) {
      this.o.log(`could not list snapshots: ${errorText(err)}`);
    }
    await this.refresh();
    return event;
  }

  /** Every service's image: what runs, and what its channel has when a check just pulled it. */
  async refresh(defs?: ServiceDef[], checks: Check[] = []): Promise<void> {
    try {
      defs ??= await this.o.stack.services();
      const previous = new Map(this.status.services.map((s) => [s.service, s.available]));
      const fresh = new Map(checks.map((c) => [c.service.name, c.available]));
      const services: ServiceImage[] = [];
      for (const s of defs) {
        const running = await this.o.stack.running(s.name);
        const availableId = fresh.has(s.name) ? fresh.get(s.name) : previous.get(s.name)?.id;
        services.push({
          service: s.name,
          image: s.image,
          ...(s.group ? { group: s.group } : {}),
          ...(s.built ? { built: true } : {}),
          ...(running ? { running: await this.o.stack.describe(running) } : {}),
          ...(availableId && availableId !== running ? { available: await this.o.stack.describe(availableId) } : {}),
        });
      }
      this.status.services = services;
    } catch (err) {
      this.o.log(`could not read the services: ${errorText(err)}`);
    }
  }
}
