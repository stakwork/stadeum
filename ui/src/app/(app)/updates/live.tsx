"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass } from "@/components/button";
import { OpsNow } from "@/components/ops";
import { Dot, type Tone } from "@/components/state";
import { absoluteTime } from "@/lib/format";
import { PHASE, withStep, type Heard, type RequestView, type UpdatesNow } from "@/lib/ops/progress";
import { checkNow, updateNow } from "./actions";

/**
 * The Updates page's live part: Check now and Update now, and what came of
 * them (lib/ops/progress.ts). A click disables its button at once. While a
 * request is open the page re-reads `GET /api/updates` every few seconds
 * and lists ops's steps as it reports them, each with its time; when the
 * request ends it says what came of it, and the rest of the page (Images,
 * Release, History) is read again. A request already open is shown, never
 * asked for twice: its button stays disabled until it ends.
 */

const EVERY_MS = 3_000;

interface Live {
  now: UpdatesNow;
  /** The steps this page saw, by request: ops reports only its latest. */
  steps: Record<string, Heard[]>;
  /** stadeum-ui did not answer the last re-reads: a release restarts it. */
  unreachable: boolean;
}

const LiveContext = createContext<Live | null>(null);

function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error("inside <LiveUpdates> only");
  return live;
}

function track(steps: Record<string, Heard[]>, now: UpdatesNow): Record<string, Heard[]> {
  let next = steps;
  for (const r of now.requests) {
    if (r.state !== "working") continue;
    const s = withStep(steps[r.id] ?? [], r.step);
    if (s !== steps[r.id]) next = { ...next, [r.id]: s };
  }
  return next;
}

const isOpen = (r: RequestView) => r.state !== "ended";

export function LiveUpdates({ initial, children }: { initial: UpdatesNow; children: React.ReactNode }) {
  const router = useRouter();
  const [now, setNow] = useState(initial);
  const [steps, setSteps] = useState(() => track({}, initial));
  const [unreachable, setUnreachable] = useState(false);

  const adopt = useCallback((next: UpdatesNow) => {
    setNow((cur) => (next.at >= cur.at ? next : cur));
    setSteps((s) => track(s, next));
  }, []);

  // The server's render after a click, or after the refresh below, is newer than what the page has.
  const [rendered, setRendered] = useState(initial);
  if (initial !== rendered) {
    setRendered(initial);
    adopt(initial);
  }

  const open = now.requests.some(isOpen);
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          const res = await fetch("/api/updates", { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const next = (await res.json()) as UpdatesNow;
          if (stopped) return;
          failures = 0;
          setUnreachable(false);
          adopt(next);
        } catch {
          if (stopped) return;
          if (++failures >= 2) setUnreachable(true);
        }
      }
      if (!stopped) timer = setTimeout(read, EVERY_MS);
    };
    timer = setTimeout(read, EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, adopt]);

  // A request that ended changed the rest of the page: read it again.
  const wasOpen = useRef(new Set(initial.requests.filter(isOpen).map((r) => r.id)));
  useEffect(() => {
    const ids = new Set(now.requests.filter(isOpen).map((r) => r.id));
    const ended = [...wasOpen.current].some((id) => !ids.has(id));
    wasOpen.current = ids;
    if (ended) router.refresh();
  }, [now, router]);

  return <LiveContext.Provider value={{ now, steps, unreachable }}>{children}</LiveContext.Provider>;
}

// ── the buttons ─────────────────────────────────────────────────────────

export function AskButtons() {
  const { now } = useLive();
  const update = now.requests.find((r) => r.kind === "update" && isOpen(r));
  const check = now.requests.find((r) => r.kind === "check" && isOpen(r));
  return (
    <div className="flex flex-wrap gap-3">
      <form action={checkNow}>
        <Ask
          className={buttonClass.secondary}
          busy={check ? (check.state === "working" ? "Checking…" : "Check requested") : undefined}
          disabled={!!update}
          title={update && !check ? "Update now checks the channels too." : undefined}
        >
          Check now
        </Ask>
      </form>
      <form action={updateNow}>
        <Ask className={buttonClass.primary} busy={update ? (update.state === "working" ? "Updating…" : "Update requested") : undefined}>
          Update now
        </Ask>
      </form>
    </div>
  );
}

function Ask({ className, busy, disabled, title, children }: { className: string; busy?: string; disabled?: boolean; title?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || !!busy || disabled} aria-disabled={pending || !!busy || disabled} className={className} title={title}>
      {pending ? "Requesting…" : (busy ?? children)}
    </button>
  );
}

// ── now ─────────────────────────────────────────────────────────────────

export function NowPanel() {
  const { now, steps, unreachable } = useLive();
  const busy = now.requests.some(isOpen);
  const h = now.heard;
  return (
    <div aria-live="polite" className="flex flex-col gap-4 [&>*+*]:border-t [&>*+*]:border-rule-soft [&>*+*]:pt-4">
      {/* While a request is open, its block says what ops is doing. */}
      {unreachable && (
        <p className="text-[13px] text-ink-3">stadeum-ui is not answering: a release restarts it. The page tries again every few seconds.</p>
      )}
      {!busy && <OpsNow report={h ? { status: { phase: h.phase, ...(h.detail ? { detail: h.detail } : {}) }, reportedAt: h.at } : null} asked={now.asked} />}
      {now.requests.map((r) => (
        <Request key={r.id} r={r} steps={steps[r.id] ?? []} />
      ))}
    </div>
  );
}

const WAITING = { update: "Update requested", check: "Check requested" } as const;
const WORKING = { update: "Updating", check: "Checking" } as const;

function Request({ r, steps }: { r: RequestView; steps: Heard[] }) {
  if (r.state === "waiting") {
    return (
      <Block tone="pending" label={WAITING[r.kind]} when={<>asked <Clock at={r.askedAt} /></>}>
        <p>{r.note}</p>
      </Block>
    );
  }
  if (r.state === "working") {
    return (
      <Block tone="pending" label={WORKING[r.kind]} when={<>asked <Clock at={r.askedAt} /></>}>
        <Steps steps={steps.length ? steps : [r.step]} live />
      </Block>
    );
  }
  return (
    <Block tone={r.tone} label={r.label} when={<Clock at={r.endedAt} />}>
      {r.notes.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
      {steps.length > 0 && <Steps steps={steps} />}
    </Block>
  );
}

function Block({ tone, label, when, children }: { tone: Tone; label: string; when: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-[14px]">
      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <Dot tone={tone} label={label} />
        <span className="tabular text-[12.5px] text-ink-3">{when}</span>
      </span>
      <div className="flex flex-col gap-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** ops's steps, oldest first, each with the time it began; the last pulses while ops is on it. */
function Steps({ steps, live = false }: { steps: Heard[]; live?: boolean }) {
  return (
    <ol className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {steps.map((s, i) => {
        const current = live && i === steps.length - 1;
        return (
          <li key={`${s.phase}-${s.at}`} className="contents">
            <span className="tabular pt-px text-[12.5px] text-ink-3">
              <Clock at={s.at} seconds />
            </span>
            <span className="flex flex-col">
              <span className={`inline-flex items-center gap-2 ${current ? "text-ink" : "text-ink-2"}`}>
                {PHASE[s.phase]}
                {current && <span aria-hidden className="inline-block size-[6px] rounded-full bg-accent motion-safe:animate-pulse" />}
              </span>
              {s.detail && <span className="text-[12.5px] text-ink-3">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── times ───────────────────────────────────────────────────────────────

const subscribe = () => () => {};

/**
 * A time of day in the reader's own zone. The server renders in the box's
 * (UTC, usually), so it writes nothing there and the browser fills it in.
 */
function Clock({ at, seconds = false }: { at: string; seconds?: boolean }) {
  const here = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const d = new Date(at);
  return (
    <time dateTime={at} title={here ? absoluteTime(d) : undefined}>
      {here ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }) : ""}
    </time>
  );
}
