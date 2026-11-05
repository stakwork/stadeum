import { Dot, type Tone } from "@/components/state";
import { absoluteTime, relativeTime } from "@/lib/format";
import type { ImageRef, OpsEvent, OpsStatus, Phase, RequestKind } from "@/lib/ops/contract";
import type { HistoryEntry } from "@/lib/ops/store";

/** The Updates and Backups pages' shared parts: what ops is doing, and what it did. */

/** ops reports every half minute when idle; longer than this and it is not answering. */
const STALE_MS = 3 * 60_000;

const PHASE: Record<Phase, string> = {
  idle: "Idle",
  checking: "Checking the channels",
  draining: "Waiting for strut to finish its runs",
  "backing-up": "Backing up",
  updating: "Updating",
  "rolling-back": "Putting the previous images and stack files back",
  restoring: "Restoring",
};

const ASKED: Record<RequestKind, string> = { check: "a check", update: "an update", backup: "a backup", confirm: "the held release, after a backup" };

export function OpsNow({
  report,
  asked,
  now = new Date(),
}: {
  report: { status: OpsStatus; reportedAt: Date } | null;
  asked: RequestKind[];
  now?: Date;
}) {
  let tone: Tone;
  let label: string;
  let note: React.ReactNode = null;
  if (!report) {
    tone = "muted";
    label = "ops has not reported yet";
    note = (
      <>
        Is its container running? <code className="font-mono text-[12.5px]">docker compose … logs ops</code>
      </>
    );
  } else if (report.status.phase === "idle" && now.getTime() - report.reportedAt.getTime() > STALE_MS) {
    tone = "attention";
    label = "ops is not answering";
    note = (
      <>
        Last heard from <time title={absoluteTime(report.reportedAt)}>{relativeTime(report.reportedAt, now)}</time>.
      </>
    );
  } else {
    const busy = report.status.phase !== "idle";
    tone = busy ? "pending" : "ok";
    label = PHASE[report.status.phase];
    note = report.status.detail ?? null;
  }
  return (
    <div className="flex flex-col gap-1.5 text-[14px]">
      <span>
        <Dot tone={tone} label={label} />
      </span>
      {note && <span className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">{note}</span>}
      {asked.length > 0 && (
        <span className="text-[13px] text-ink-3">
          Asked for {[...new Set(asked)].map((k) => ASKED[k]).join(" and ")}: ops takes it up within half a minute.
        </span>
      )}
    </div>
  );
}

const OUTCOME: Record<OpsEvent["outcome"], { tone: Tone; label: string }> = {
  ok: { tone: "ok", label: "Done" },
  "rolled-back": { tone: "attention", label: "Rolled back" },
  failed: { tone: "attention", label: "Failed" },
  skipped: { tone: "muted", label: "Held back" },
};

export function History({ entries, empty }: { entries: HistoryEntry[]; empty: string }) {
  if (!entries.length) return <p className="text-[14px] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-rule-soft overflow-hidden rounded-xl border border-rule bg-surface">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-5 py-4">
          <span className="w-[110px] shrink-0 text-[13px]">
            <Dot {...OUTCOME[e.outcome]} />
          </span>
          <span className="min-w-0 flex-[1_1_320px] text-[14px] text-ink-2 [overflow-wrap:anywhere]">{e.detail}</span>
          <time className="tabular text-[13px] text-ink-3" dateTime={e.endedAt.toISOString()} title={absoluteTime(e.endedAt)}>
            {relativeTime(e.endedAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** An image as people tell them apart: its commit, else its ID. */
export function shortImage(r: ImageRef | undefined): string {
  if (!r) return "—";
  return r.revision ? r.revision.slice(0, 7) : r.id.replace(/^sha256:/, "").slice(0, 12);
}

/** The tag a reference names: `neo4j:5.26.32` → `5.26.32`. */
export function tagOf(image: string): string {
  const at = image.lastIndexOf(":");
  return at > image.lastIndexOf("/") ? image.slice(at + 1) : "latest";
}
