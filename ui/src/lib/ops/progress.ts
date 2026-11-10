import type { Tone } from "@/components/state";
import { relativeTime } from "@/lib/format";
import { shortLatest } from "./channel";
import type { OpsEvent, OpsStatus, Phase, RequestKind } from "./contract";

/**
 * What the Updates page says of an admin's Check now and Update now, from
 * three things stadeum-ui already has: the request, the status ops reports
 * while it works, and the history it records. A request waits until ops
 * takes it up (ops looks every half minute), is worked on while ops reports
 * a phase of it, and has ended once ops marks it done and is idle again:
 * then the history recorded since it was asked says what came of it, and
 * nothing recorded means nothing moved.
 *
 * Update now can end after its request is marked done: ops marks it done,
 * then hands stadeum's release to the ops it brings, which applies it
 * (docs/stack-spec.md, "A release"). Its status says so (updating) until
 * that one records the outcome and goes idle.
 */

/** ops reports every half minute when idle; longer than this and it is not answering. */
export const SILENT_MS = 3 * 60_000;

/** How long the page keeps saying what came of a request; History has it after. */
export const SHOW_MS = 15 * 60_000;

export const PHASE: Record<Phase, string> = {
  idle: "Idle",
  checking: "Checking the channels",
  draining: "Waiting for strut to finish its runs",
  "backing-up": "Backing up",
  updating: "Updating",
  "rolling-back": "Putting the previous images and stack files back",
  restoring: "Restoring",
};

/** ops busy with something else, as the line under a waiting request says it. */
const BUSY: Record<Phase, string> = {
  idle: "idle",
  checking: "checking the channels",
  draining: "waiting for strut's runs",
  "backing-up": "backing up",
  updating: "updating",
  "rolling-back": "rolling back",
  restoring: "restoring",
};

/** The requests the page follows. */
export type Asked = Extract<RequestKind, "check" | "update">;
export const ASKED: readonly Asked[] = ["update", "check"];

/** The phases of an update, and those of a release still going in after its request is done. */
const UPDATING = new Set<Phase>(["checking", "draining", "updating", "rolling-back"]);
const RELEASING = new Set<Phase>(["draining", "updating", "rolling-back"]);

export interface AskedRow {
  id: string;
  kind: Asked;
  createdAt: Date;
  doneAt: Date | null;
}

export interface EventRow {
  kind: OpsEvent["kind"];
  outcome: OpsEvent["outcome"];
  detail: string;
  /** When stadeum-ui stored it: the same clock as the request's. */
  createdAt: Date;
}

/** ops's last word: what it is doing, and when it said so. */
export interface Heard {
  phase: Phase;
  detail?: string;
  at: string;
}

export type RequestView = { id: string; kind: Asked; askedAt: string } & (
  | { state: "waiting"; note: string }
  | { state: "working"; step: Heard }
  | { state: "ended"; endedAt: string; tone: Tone; label: string; notes: string[] }
);

/** The Updates page's live part, as JSON: the page's first render and every re-read (`GET /api/updates`). */
export interface UpdatesNow {
  /** When stadeum-ui answered: an older answer never replaces a newer one. */
  at: string;
  heard: Heard | null;
  /** The other requests still open (the held release's confirmation), for the line under ops's state. */
  asked: RequestKind[];
  requests: RequestView[];
}

export type Report = { status: OpsStatus; reportedAt: Date } | null;

export function updatesNow(input: {
  now: Date;
  report: Report;
  open: RequestKind[];
  /** The latest Check now and Update now. */
  latest: AskedRow[];
  /** The one of either kind ops marked done last. */
  lastDone: string | null;
  events: EventRow[];
}): UpdatesNow {
  const { now, report } = input;
  const views = ASKED.flatMap((kind) => {
    const r = input.latest.find((l) => l.kind === kind);
    return r ? [viewRequest(r, report, input.events, now)] : [];
  });
  // What came of a request is news until ops has done another: the last one done says how things stand.
  const shown = views.filter((v) => v.state !== "ended" || (v.id === input.lastDone && now.getTime() - new Date(v.endedAt).getTime() < SHOW_MS));
  const open = (v: RequestView) => (v.state === "ended" ? 0 : 1);
  const requests = shown.sort((a, b) => open(b) - open(a) || b.askedAt.localeCompare(a.askedAt)); // what is still open first, then the newest
  return {
    at: now.toISOString(),
    heard: report ? { phase: report.status.phase, ...(report.status.detail ? { detail: report.status.detail } : {}), at: report.reportedAt.toISOString() } : null,
    asked: input.open.filter((k) => !ASKED.includes(k as Asked)),
    requests,
  };
}

export function viewRequest(r: AskedRow, report: Report, allEvents: EventRow[], now: Date): RequestView {
  const base = { id: r.id, kind: r.kind, askedAt: r.createdAt.toISOString() };
  const events = allEvents.filter((e) => e.createdAt >= r.createdAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const phase = report?.status.phase;
  // After it is done, a release may still be going in; anything recorded since says it has ended.
  const since = r.doneAt && events.some((e) => e.createdAt > r.doneAt!);
  const working = !phase
    ? false
    : !r.doneAt
      ? r.kind === "update"
        ? UPDATING.has(phase)
        : phase === "checking"
      : r.kind === "update" && RELEASING.has(phase) && !since;

  if (working) {
    const s = report!.status;
    return { ...base, state: "working", step: { phase: s.phase, ...(s.detail ? { detail: s.detail } : {}), at: report!.reportedAt.toISOString() } };
  }
  if (!r.doneAt) return { ...base, state: "waiting", note: waitingNote(report, now) };

  const status = report?.status;
  if (r.kind === "check") {
    if (!status?.checkedAt || new Date(status.checkedAt) < r.createdAt) {
      const endedAt = r.doneAt.toISOString();
      return { ...base, state: "ended", endedAt, tone: "attention", label: "Not checked", notes: ["ops took the request, but could not ask the registries. Its log says why."] };
    }
    // What the registries said, and when: ops's latest asking, this one or one since.
    const f = found(status, now);
    return { ...base, state: "ended", endedAt: new Date(status.checkedAt).toISOString(), tone: f.tone, label: "Checked", notes: [f.note] };
  }

  const updates = events.filter((e) => e.kind === "update");
  const last = updates.at(-1)?.createdAt;
  const endedAt = (last && last > r.doneAt ? last : r.doneAt).toISOString();
  if (!updates.length) {
    // An idle status keeps what its last check could not do (ops.ts, check).
    if (status?.phase === "idle" && status.detail) return { ...base, state: "ended", endedAt, tone: "attention", label: "Nothing updated", notes: [sentence(status.detail)] };
    const f = found(status, now);
    return { ...base, state: "ended", endedAt, tone: f.tone, label: f.tone === "ok" ? "Nothing to update" : "Nothing updated", notes: [f.note] };
  }
  const outcomes = new Set(updates.map((e) => e.outcome));
  const [tone, label]: [Tone, string] = outcomes.has("failed")
    ? ["attention", "Update failed"]
    : outcomes.has("rolled-back")
      ? ["attention", "Rolled back"]
      : outcomes.has("ok")
        ? ["ok", "Updated"]
        : ["muted", "Held back"];
  const notes = updates.map((e) => (updates.length > 1 ? `${OUTCOME[e.outcome]}: ${e.detail}` : e.detail));
  return { ...base, state: "ended", endedAt, tone, label, notes };
}

/**
 * The steps a page saw, as ops reported them: a new phase is a new step;
 * the same phase again (strut's drain counting down) changes its detail
 * and keeps when it began.
 */
export function withStep(steps: Heard[], step: Heard): Heard[] {
  const last = steps.at(-1);
  if (!last || last.phase !== step.phase) return [...steps, step];
  return last.detail === step.detail ? steps : [...steps.slice(0, -1), { ...step, at: last.at }];
}

const OUTCOME: Record<OpsEvent["outcome"], string> = { ok: "Done", "rolled-back": "Rolled back", failed: "Failed", skipped: "Held back" };

function waitingNote(report: Report, now: Date): string {
  if (!report) return "ops has not reported yet. Is its container running?";
  const { phase } = report.status;
  if (phase !== "idle") return `ops is ${BUSY[phase]} first, and takes this up after.`;
  if (now.getTime() - report.reportedAt.getTime() > SILENT_MS) return `ops is not answering: last heard from ${relativeTime(report.reportedAt, now)}.`;
  return "ops takes it up within half a minute.";
}

/**
 * What the last check found, in a sentence or a few: what is current, what
 * is out, what could not be asked. The images that follow a channel only;
 * stadeum-ui and ops are said once, as the release.
 */
export function found(status: OpsStatus | undefined, now: Date): { tone: Tone; note: string } {
  const followed = (status?.services ?? []).filter((s) => s.group && !s.built);
  if (!followed.length) return { tone: "muted", note: "ops has not said what follows a channel yet." };
  const problems = followed.filter((s) => s.latest?.problem);
  const out = followed.filter((s) => !s.release && !s.latest?.problem && s.latest?.current === false);
  const self = followed.find((s) => s.release && s.latest?.current === false && !s.latest.problem);
  const release = status?.release;
  const parts = out.map((s) => `${s.service}: ${shortLatest(s.latest!)} is out${s.latest!.created ? `, built ${relativeTime(s.latest!.created, now)}` : ""}.`);
  let movable = out.length;
  if (release?.available || self) {
    const which = release?.available ? short(release.available) : shortLatest(self!.latest!);
    const held = !!release?.held?.length;
    parts.push(held ? `Release ${which} is out, and waits for you above.` : `Release ${which} is out.`);
    if (!held) movable++;
  }
  for (const s of problems) parts.push(`Could not check ${s.service}: ${sentence(s.latest!.problem!)}`);
  if (problems.length) return { tone: "attention", note: parts.join(" ") };
  if (movable) parts.push(`Update now, or the next window, brings ${movable === 1 ? "it" : "them"} in.`);
  if (parts.length) return { tone: "pending", note: parts.join(" ") };
  const current = followed.filter((s) => s.latest?.current).map((s) => s.service);
  if (current.length < followed.length) return { tone: "muted", note: "ops has not asked every registry yet." };
  return { tone: "ok", note: `Everything is current: ${list(current)} ${current.length === 1 ? "runs what its channel names" : "run what their channels name"}.` };
}

const short = (r: { id: string; revision?: string }) => (r.revision ? r.revision.slice(0, 7) : r.id.replace(/^sha256:/, "").slice(0, 12));
const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
