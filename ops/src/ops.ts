import type { ServiceDef, Stack } from "./compose.js";
import type { Destination, ImageRef, Latest, OpsEvent, OpsSettings, OpsStatus, ReleaseStatus, ServiceImage } from "./contract.js";
import { backup } from "./backup.js";
import { errorText, type Deps } from "./deps.js";
import { describePruned, Images } from "./images.js";
import type { RegistryApi } from "./registry.js";
import { planRelease, upgrades, type Plan } from "./release.js";
import type { ResticApi } from "./restic.js";
import { Outbox, type StadeumApi } from "./stadeum.js";
import type { StrutApi } from "./strut.js";
import { checkGroup, handOver, isNewer, lookUp, releaseGroup, short, updateGroup, updateGroups, type Check, type Group } from "./update.js";
import { currentWindow } from "./window.js";

/**
 * The loop. Every tick ops reads its settings from stadeum-ui, does what
 * an admin asked for (check, update, back up, or let a held release in),
 * and once in each day's window runs the daily pass: the backup, then the
 * updates (held when tonight's backup failed): strut's channel first, then
 * stadeum's release, which the ops it brings applies. While that one-off
 * runs, this ops waits. Every 10 minutes between, it asks the registries
 * what the channels name (look): what the Updates page says.
 */

/** How often ops asks the registries what the channels name. */
export const LOOK_EVERY_MS = 10 * 60_000;

export interface OpsDeps {
  stack: Stack;
  strut: StrutApi;
  stadeum: StadeumApi;
  registry: RegistryApi;
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

/** The release on stadeum's channel, as a check found it. */
export interface ReleaseCheck {
  /** stadeum-ui's and ops's images: what runs, and what the channel has. */
  checks: Check[];
  /** What moving to it changes, when the channel has another. */
  plan?: Plan;
  problem?: string;
}

interface Checked {
  groups: Array<{ group: Group; checks: Check[] }>;
  release?: ReleaseCheck;
}

/** A release to hand over: its images, and the references an admin confirmed. */
export interface HandOver {
  checks: Check[];
  confirmed: string[];
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
  private waiting = false;
  /** The held release last recorded in the history, so a hold is said once. */
  private heldSaid: string | null = null;
  /** Old images: what ops keeps, and what it removes after an update. */
  readonly images: Images;
  /** What each followed service's registry said last, by service. */
  private latest = new Map<string, Latest>();
  private lookedAt: number | null = null;

  constructor(private readonly o: OpsDeps) {
    this.status = { phase: "idle", version: o.version, services: [] };
    this.outbox = new Outbox(o.stadeum, o.log);
    this.images = new Images(o.stack, o.log);
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

  /** Record what ops did; it waits here until stadeum-ui takes it. */
  record(event: OpsEvent): Promise<void> {
    return this.outbox.record(event);
  }

  /** Send what waits; the count still waiting. */
  async flush(): Promise<void> {
    await this.outbox.flush();
  }

  get unsent(): number {
    return this.outbox.pending;
  }

  /** What ops would report now. */
  get state(): OpsStatus {
    return this.status;
  }

  async tick(): Promise<void> {
    // A release is being applied by the ops it brings: it reports, and this one keeps still.
    const handing = await this.o.stack.handingOver().catch(() => false);
    const handedOver = this.waiting && !handing;
    if (handing !== this.waiting) this.o.log(handing ? "a release is being applied: waiting" : "the release hand-over is done");
    this.waiting = handing;
    if (handing) return;

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
    // What runs now is the release, or the one it rolled back to: say so.
    if (handedOver) await this.look().catch((err) => this.o.log(`registry check failed: ${errorText(err)}`));
    if (!this.status.services.length) await this.refresh();

    for (const id of [...this.handled]) if (!settings.requests.some((r) => r.id === id)) this.handled.delete(id);
    const requests = settings.requests.filter((r) => !this.handled.has(r.id));
    if (requests.length) return this.answer(settings, requests);

    const window = currentWindow(this.o.now(), settings.window);
    if (window && window !== settings.lastCycle && window !== this.lastCycle) return this.daily(settings, window);
    if (this.lookedAt === null || this.o.now().getTime() - this.lookedAt >= LOOK_EVERY_MS) {
      await this.look().catch((err) => this.o.log(`registry check failed: ${errorText(err)}`));
    }
    await this.report({ phase: "idle" });
  }

  /** "Check now", "Update now", "Back up now", "Upgrade Neo4j": what was asked, once each however often it was. */
  private async answer(settings: OpsSettings, requests: OpsSettings["requests"]): Promise<void> {
    const kinds = new Set(requests.map((r) => r.kind));
    const confirm = requests.filter((r) => r.kind === "confirm").at(-1);
    for (const r of requests) this.handled.add(r.id);
    let next: HandOver | null = null;
    try {
      if (confirm) next = await this.confirm(settings, new Set((confirm.target ?? "").split(",").filter(Boolean)));
      else {
        if (kinds.has("backup")) await this.backup(settings);
        if (kinds.has("update")) next = await this.update(settings, true);
        else if (kinds.has("check")) {
          await this.report({ phase: "checking", detail: "Asking the registries what the channels name" });
          await this.look();
        }
      }
    } finally {
      this.unsentDone.push(...requests.map((r) => r.id));
      await this.report(next ? this.handing() : { phase: "idle" });
    }
    if (next) await this.handOver(next);
  }

  /** What ops says while the release goes to the ops it brings: not idle, until that one reports. */
  private handing(): Partial<OpsStatus> {
    const r = this.status.release;
    const which = r?.available ? `release ${short(r.running)} → ${short(r.available)}` : "the release";
    return { phase: "updating", detail: `Handing ${which} to the ops it brings` };
  }

  /** Hand the release over; one that cannot start is recorded, and ops is idle again. */
  private async handOver(next: HandOver): Promise<void> {
    try {
      await handOver(this.deps, next.checks, next.confirmed);
    } catch (err) {
      this.o.log(`could not hand the release over: ${errorText(err)}`);
      const at = this.o.now().toISOString();
      await this.outbox.record({ kind: "update", outcome: "failed", startedAt: at, endedAt: at, detail: `The release was not applied: the ops it brings did not start (${errorText(err)}). Nothing of it changed.` });
      await this.report({ phase: "idle" });
    }
  }

  private async daily(settings: OpsSettings, window: string): Promise<void> {
    this.lastCycle = window;
    this.o.log(`daily pass for the window of ${window}`);
    let next: HandOver | null = null;
    try {
      const backedUp = settings.backups?.enabled ? await this.backup(settings) : null;
      if (settings.updates.enabled) {
        if (backedUp?.outcome === "failed") {
          const at = this.o.now().toISOString();
          await this.outbox.record({ kind: "update", outcome: "skipped", startedAt: at, endedAt: at, detail: "Updates held back: tonight's backup failed." });
        } else {
          next = await this.update(settings, false);
        }
      }
    } finally {
      await this.report({ ...(next ? this.handing() : { phase: "idle" }), lastCycle: window });
    }
    if (next) await this.handOver(next);
  }

  /**
   * Ask each channel's registry what its tag names, and compare with what
   * runs (lookUp): what the Updates page says. Nothing is pulled, except
   * stadeum's release once its channel names another: its two small images
   * carry what it would change (the stack files, a Neo4j held for an
   * admin), so the page can say so before the window.
   */
  async look(): Promise<Map<string, Latest>> {
    const at = this.o.now();
    this.lookedAt = at.getTime();
    const defs = await this.o.stack.services();
    const self = this.o.stack.self;
    const followed = [...updateGroups(defs, self).flatMap((g) => g.services), ...releaseGroup(defs, self)];
    const runs = new Map<string, ImageRef>();
    await Promise.all(
      followed.map(async (s) => {
        const id = await this.o.stack.running(s.name).catch(() => undefined);
        const running = id ? await this.o.stack.describe(id).catch((): ImageRef => ({ id })) : undefined;
        if (running) runs.set(s.name, running);
        this.latest.set(s.name, await lookUp(this.o.registry, s, running, this.latest.get(s.name), at.toISOString()));
      }),
    );
    for (const name of [...this.latest.keys()]) if (!followed.some((s) => s.name === name)) this.latest.delete(name);
    const checks = await this.lookAtRelease(defs, runs.get(self));
    this.status.checkedAt = at.toISOString();
    await this.refresh(defs, checks);
    return this.latest;
  }

  /** The release's status, as the registry's answer for ops's own image has it. Its checks, when it was pulled. */
  private async lookAtRelease(defs: ServiceDef[], running: ImageRef | undefined): Promise<Check[]> {
    const l = this.latest.get(this.o.stack.self);
    if (!l?.digest || l.problem) return [];
    if (l.current) {
      this.status.release = running ? { running } : {};
      return [];
    }
    // Read once for each release the channel names.
    if (this.status.release?.available?.digests?.includes(l.digest)) return [];
    await this.report({ phase: "checking", detail: `Reading release ${(l.revision ?? l.digest.replace(/^sha256:/, "")).slice(0, 7)}` });
    try {
      const release = await this.checkRelease(defs);
      for (const c of release?.checks ?? []) {
        await this.images.channel(c.service, c.available, c.before, c.running).catch((err) => this.o.log(`could not name ${c.service.name}'s channel image: ${errorText(err)}`));
      }
      this.status.release = await this.releaseStatus(release);
      return release?.checks ?? [];
    } catch (err) {
      this.o.log(`could not read the release: ${errorText(err)}`);
      this.status.release = { ...(running ? { running } : {}), problem: errorText(err) };
      return [];
    }
  }

  /**
   * Pull every update group and stadeum's release, and compare with what
   * runs: what an update moves. Nothing that runs is touched, and the release's tags stay on
   * what runs: only applying it moves them, so a person's `compose up`
   * does not bring half a release in. An image that failed before keeps
   * its tag off too.
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
    for (const c of groups.flatMap((g) => g.checks)) {
      if (c.running && c.available && c.available !== c.running && failed.has(c.available)) await this.o.stack.tag(c.running, c.service.image);
    }
    let release: ReleaseCheck | undefined;
    try {
      release = await this.checkRelease(defs);
    } catch (err) {
      problems.push(`the release: ${errorText(err)}`);
    }
    if (release?.problem) problems.push(`the release: ${release.problem}`);
    for (const p of problems) this.o.log(`check failed: ${p}`);
    await this.refresh(defs, [...groups.flatMap((g) => g.checks), ...(release?.checks ?? [])]);
    for (const c of [...groups.flatMap((g) => g.checks), ...(release?.checks ?? [])]) {
      await this.images.channel(c.service, c.available, c.before, c.running).catch((err) => this.o.log(`could not name ${c.service.name}'s channel image: ${errorText(err)}`));
    }
    this.status.release = await this.releaseStatus(release);
    await this.report({ phase: "idle", ...(problems.length ? { detail: `Could not check ${problems.join("; ")}` } : {}) });
    return { groups, ...(release ? { release } : {}) };
  }

  private async checkRelease(defs: ServiceDef[]): Promise<ReleaseCheck | undefined> {
    const services = releaseGroup(defs, this.o.stack.self);
    if (!services.length) return undefined;
    const checks = await checkGroup(this.o.stack, services);
    for (const c of checks) if (c.running && c.available && c.available !== c.running) await this.o.stack.tag(c.running, c.service.image);
    if (!checks.some(isNewer)) return { checks };
    const self = checks.find((c) => c.service.name === this.o.stack.self);
    const nextOps = self?.available ?? self?.running;
    if (!nextOps) return { checks, problem: "no ops image to read it from" };
    const next = await this.o.stack.releaseOf(nextOps);
    if (!next?.size) return { checks, problem: `the channel's ops image (${short({ id: nextOps })}) carries no stack files` };
    const running = self?.running ? await this.o.stack.releaseOf(self.running) : null;
    return { checks, plan: await planRelease(this.o.stack, next, running) };
  }

  private async releaseStatus(release: ReleaseCheck | undefined): Promise<ReleaseStatus | undefined> {
    if (!release) return undefined;
    const self = release.checks.find((c) => c.service.name === this.o.stack.self);
    const p = release.plan;
    return {
      ...(self?.running ? { running: await this.o.stack.describe(self.running) } : {}),
      ...(self && isNewer(self) ? { available: await this.o.stack.describe(self.available!) } : {}),
      ...(p?.files.length ? { files: p.files } : {}),
      ...(p?.images.length ? { images: p.images } : {}),
      ...(p?.held.length ? { held: p.held } : {}),
      ...(release.problem ? { problem: release.problem } : {}),
    };
  }

  /**
   * Check, then move each group that has something new, strut's first.
   * Returns the release to hand over, when stadeum's channel has one that
   * may go in: not held for an admin's word (unless `confirmed`), and not
   * one that failed before (unless `force`, an admin's Update now).
   */
  async update(settings: OpsSettings, force: boolean, confirmed: ReadonlySet<string> = new Set()): Promise<HandOver | null> {
    const failed = new Set(settings.failedImages);
    const { groups, release } = await this.check(force ? new Set() : failed);
    const events: OpsEvent[] = [];
    for (const { group, checks } of groups) {
      const event = await updateGroup(this.deps, group, checks, { force, failed, drainMinutes: settings.drainMinutes });
      if (!event) continue;
      events.push(event);
      // What ran before is `ops-previous` now; a rollback keeps it all as it was.
      if (event.outcome === "ok") {
        for (const c of checks) if (c.running && c.available && c.running !== c.available) await this.images.moved(c.service.name, c.service.image, c.running, true);
      }
    }
    // Old images go at the end of the pass, before a release is handed over (its images are `ops-channel`):
    // the ops it brings replaces this one, and what this one meant to remove would be forgotten.
    if (!events.some((e) => e.outcome === "failed")) {
      const pruned = describePruned(await this.images.prune(await this.o.stack.services()));
      const last = events.at(-1);
      if (pruned && last) last.detail = `${last.detail} ${pruned}`;
      else if (pruned) {
        const at = this.o.now().toISOString();
        events.push({ kind: "update", outcome: "ok", startedAt: at, endedAt: at, detail: pruned });
      }
    }
    for (const e of events) await this.outbox.record(e);
    await this.look().catch(async (err) => {
      this.o.log(`registry check failed: ${errorText(err)}`);
      await this.refresh();
    });
    if (!release?.plan) return null;
    const moving = release.checks.filter(isNewer);
    const held = release.plan.held.filter((h) => !confirmed.has(h.to));
    if (held.length) {
      const id = moving.map((c) => c.available).join(",");
      if (this.heldSaid !== id) {
        this.heldSaid = id;
        const at = this.o.now().toISOString();
        await this.outbox.record({
          kind: "update",
          outcome: "skipped",
          startedAt: at,
          endedAt: at,
          detail: `A release is waiting: it ${upgrades(held)}, which cannot be undone. Nothing moves until an admin confirms it here; ops backs up first.`,
        });
      }
      return null;
    }
    if (!force && moving.every((c) => failed.has(c.available!))) {
      this.o.log("the release is held back: it failed its health check before");
      return null;
    }
    return { checks: release.checks, confirmed: release.plan.held.map((h) => h.to) };
  }

  /**
   * An admin confirmed the held release (Upgrade Neo4j). Only the moves
   * they saw go in, and only after a fresh backup.
   */
  private async confirm(settings: OpsSettings, targets: ReadonlySet<string>): Promise<HandOver | null> {
    const at = () => this.o.now().toISOString();
    const startedAt = at();
    const say = (outcome: OpsEvent["outcome"], detail: string) => this.outbox.record({ kind: "update", outcome, startedAt, endedAt: at(), detail });
    const { release } = await this.check();
    const held = release?.plan?.held ?? [];
    if (!held.length) {
      await say("skipped", "Nothing was waiting for a confirmation any more.");
      return null;
    }
    const other = held.filter((h) => !targets.has(h.to));
    if (other.length) {
      await say("skipped", `The release waiting now ${upgrades(other)}, which is not what was confirmed: confirm it again.`);
      return null;
    }
    if (!settings.backups) {
      await say("failed", `Not upgraded: it ${upgrades(held)} only after a fresh backup, and no backup destination is set (Backups).`);
      return null;
    }
    const backedUp = await this.backup(settings);
    if (backedUp?.outcome !== "ok") {
      await say("failed", `Not upgraded: the backup before it failed. ${backedUp?.detail ?? ""}`.trim());
      return null;
    }
    return this.update(settings, true, targets);
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

  /** Every service's image: what runs, what a pull brought that does not run yet, and what the registry said. */
  async refresh(defs?: ServiceDef[], checks: Check[] = []): Promise<void> {
    try {
      defs ??= await this.o.stack.services();
      const previous = new Map(this.status.services.map((s) => [s.service, s.available]));
      const fresh = new Map(checks.map((c) => [c.service.name, c.available]));
      const release = new Set(releaseGroup(defs, this.o.stack.self).map((s) => s.name));
      const services: ServiceImage[] = [];
      for (const s of defs) {
        const running = await this.o.stack.running(s.name);
        const availableId = fresh.has(s.name) ? fresh.get(s.name) : previous.get(s.name)?.id;
        const latest = this.latest.get(s.name);
        services.push({
          service: s.name,
          image: s.image,
          ...(s.group ? { group: s.group } : {}),
          ...(s.built ? { built: true } : {}),
          ...(release.has(s.name) ? { release: true } : {}),
          ...(running ? { running: await this.o.stack.describe(running) } : {}),
          ...(availableId && availableId !== running ? { available: await this.o.stack.describe(availableId) } : {}),
          ...(latest ? { latest } : {}),
        });
      }
      this.status.services = services;
    } catch (err) {
      this.o.log(`could not read the services: ${errorText(err)}`);
    }
  }
}
