"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { buttonClass } from "@/components/button";
import { HangUpIcon, MicIcon, callStatus, useCall, useClock, type Call } from "@/components/call";
import { Waveform, type WaveMode } from "@/components/waveform";
import { shownEntries, type CallArtifact, type Entry } from "@/lib/call-transcript";
import { callDuration } from "@/lib/calls";
import { shownTheme } from "@/lib/theme";
import { openInStrut } from "./actions";

/**
 * The call, whole page. Before it starts: the waveform in its orb, alone in
 * the middle, and Talk. As it starts the orb shrinks and rises, the
 * transcript flows in under it, both sides as they speak, with the things
 * the assistant hands over as cards under the reply they came with, and
 * Mute and End settle at the bottom. A card opens through strut, in a
 * panel beside the transcript (over it on a phone); the call goes on. When
 * it ends the transcript stays to read, and its cards to open, until the
 * next call.
 */
export function CallScreen() {
  const call = useCall();
  const entries = shownEntries(call.transcript);
  const risen = call.active || (call.phase === "ended" && entries.length > 0);
  const [viewer, setViewer] = useState<Viewing | null>(null);

  const open = useCallback(async (a: CallArtifact) => {
    if (!a.target) return;
    if ("href" in a.target) {
      window.open(a.target.href, "_blank", "noopener,noreferrer");
      return;
    }
    const opening: Viewing = { id: a.id, title: a.title };
    setViewer(opening);
    const got = await openInStrut(a.target).catch(() => ({ error: "This can’t open right now." }));
    setViewer((v) => (v?.id === opening.id ? { ...opening, ...got } : v));
  }, []);

  // M mutes while live; Escape closes what is open beside the call.
  const { phase, toggleMicrophone } = call;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") setViewer(null);
      if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey && phase === "live") toggleMicrophone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleMicrophone]);

  // A new call starts on a clean page.
  useEffect(() => {
    if (phase === "starting") setViewer(null);
  }, [phase]);

  const rise = "transition-[flex-grow] duration-700 ease-out-soft motion-reduce:transition-none";
  return (
    // `data-bleed`: the layout gives this page all of its space.
    <div data-bleed className="relative min-h-[520px] flex-1">
      <div className="absolute inset-0 flex">
        <section aria-label={`Call with ${call.assistant}`} className="relative flex min-w-0 flex-1 flex-col">
          <div className={`${rise} ${risen ? "grow-0" : "grow"}`} />
          <Stage call={call} risen={risen} />
          <TranscriptView call={call} entries={entries} risen={risen} open={open} openId={viewer?.id} className={`${rise} ${risen ? "grow" : "grow-0"}`} />
          <div className={`${rise} ${risen ? "grow-0" : "grow"}`} />
          <Controls call={call} risen={risen} />
        </section>
        {viewer && <Viewer viewing={viewer} close={() => setViewer(null)} />}
      </div>
    </div>
  );
}

interface Viewing {
  id: string;
  title: string;
  src?: string;
  origin?: string;
  error?: string;
}

function waveMode(call: Call): WaveMode {
  if (call.phase === "idle") return "idle";
  if (call.phase === "ended") return "ended";
  if (call.phase !== "live" || !call.agent || call.agent === "initializing") return "waiting";
  if (call.agent === "speaking") return "speaking";
  if (call.agent === "thinking") return "thinking";
  return call.microphone ? "listening" : "muted";
}

/** The orb, what the call is doing, and Talk before it starts. */
function Stage({ call, risen }: { call: Call; risen: boolean }) {
  const now = useClock(call.phase === "live");
  const idle = !call.active;
  const notices = Object.entries(call.notices);
  const orb = `grid shrink-0 place-items-center rounded-full transition-[width,height,background-color] duration-700 ease-out-soft motion-reduce:transition-none ${
    risen ? "size-[76px]" : "size-40"
  } ${call.phase === "live" ? "bg-surface shadow-soft ring-1 ring-rule" : "bg-accent-soft"}`;

  const words = call.active
    ? callStatus(call)
    : call.phase === "ended"
      ? `Call ended${call.ended?.after != null ? ` · ${callDuration(call.ended.after)}` : ""}`
      : `Talk to ${call.assistant}`;
  const detail = call.active
    ? call.liveSince
      ? callDuration(now - call.liveSince)
      : null
    : call.phase === "ended"
      ? (call.ended?.reason ?? null)
      : null;

  return (
    <div className={`flex flex-col items-center px-5 text-center transition-[padding] duration-700 ease-out-soft ${risen ? "pt-6 pb-3 md:pt-8" : "py-4"}`}>
      {idle && !risen ? (
        <button type="button" onClick={call.talk} aria-label={`Talk to ${call.assistant}`} className={`${orb} group cursor-pointer transition-transform hover:scale-[1.03] active:scale-[0.98]`}>
          <Waveform mode={waveMode(call)} levels={call.levels} height={64} />
        </button>
      ) : (
        <div className={orb}>
          <Waveform mode={waveMode(call)} levels={call.levels} height={risen ? 34 : 64} />
        </div>
      )}

      <div className={`flex flex-col items-center gap-0.5 transition-[margin] duration-700 ease-out-soft ${risen ? "mt-3" : "mt-7"}`} aria-live="polite">
        <p className={`text-ink transition-[font-size] duration-700 ease-out-soft ${risen ? "text-[15px] font-medium" : "font-serif text-[30px] leading-tight"}`}>{words}</p>
        {detail && <p className="text-[13px] text-ink-3 tabular-nums">{detail}</p>}
      </div>

      {call.error && (
        <p role="alert" className="arrive mt-5 max-w-md rounded-xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          {call.error}
        </p>
      )}
      {notices.length > 0 && (
        <div role="alert" className="mt-3 flex max-w-md flex-col items-center gap-1.5">
          {notices.map(([kind, text]) => (
            <p key={kind} className="arrive rounded-full bg-warn-soft px-3.5 py-1.5 text-[12.5px] text-warn">
              {text}
              {kind === "audio" && (
                <button type="button" onClick={call.startAudio} className="ml-2 font-medium underline underline-offset-2">
                  Play
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {idle && !risen && (
        <button type="button" onClick={call.talk} className={`${buttonClass.primary} mt-7 rounded-full px-6`}>
          <MicIcon />
          {call.phase === "ended" ? "Talk again" : "Talk"}
        </button>
      )}
    </div>
  );
}

/** Both sides' words as they come, and the cards. Follows the newest line unless the person scrolled up. */
function TranscriptView({
  call,
  entries,
  risen,
  open,
  openId,
  className,
}: {
  call: Call;
  entries: Entry[];
  risen: boolean;
  open: (a: CallArtifact) => void;
  openId?: string;
  className: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(false);
  const last = entries.at(-1);
  const tick = `${entries.length}:${last?.kind === "line" ? last.text.length : last?.cards.length}`;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else setMissed(true);
    // Only when something new arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setPinned(atEnd);
    if (atEnd) setMissed(false);
  };

  const listening = call.phase === "live" && (call.agent === "listening" || call.agent === "idle");
  return (
    <div className={`relative min-h-0 basis-0 ${className}`}>
      <div
        ref={scroller}
        onScroll={onScroll}
        className={`absolute inset-0 overflow-y-auto overscroll-contain transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,transparent,black_28px,black_calc(100%-20px),transparent)] ${
          risen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ol className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-5 pt-6 pb-8">
          {entries.length === 0 && listening && (
            <li className="arrive py-10 text-center text-[15px] text-ink-3">Go ahead, {call.assistant}’s listening.</li>
          )}
          {entries.map((e) =>
            e.kind === "line" ? (
              <li key={e.id} className={`arrive flex ${e.speaker === "you" ? "justify-end" : "justify-start"}`}>
                {e.speaker === "you" ? (
                  <p className={`max-w-[85%] rounded-[20px] rounded-br-md bg-raised px-4 py-2.5 text-[15.5px] leading-relaxed text-ink ${e.final ? "" : "opacity-70"}`}>{e.text}</p>
                ) : (
                  <p className="max-w-[92%] text-[16.5px] leading-relaxed text-ink">
                    {e.text}
                    {!e.final && call.active && <span aria-hidden className="ml-1 inline-block size-[7px] animate-pulse rounded-full bg-accent align-middle" />}
                  </p>
                )}
              </li>
            ) : (
              <li key={e.id} className="arrive flex flex-col gap-2">
                {e.cards.map((a) => (
                  <ArtifactCard key={`${e.id}/${a.id}`} artifact={a} open={open} active={openId === a.id} />
                ))}
              </li>
            ),
          )}
        </ol>
      </div>
      {missed && !pinned && (
        <button
          type="button"
          onClick={() => {
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            setMissed(false);
          }}
          className="arrive absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-rule bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 shadow-soft hover:text-ink"
        >
          Latest ↓
        </button>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  markdown: "Document",
  docx: "Document",
  redline: "Redline",
  pdf: "PDF",
  html: "Page",
  app: "App",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pull_request: "Pull request",
  diff: "Changes",
  code: "Code",
  log: "Log",
  json: "Data",
  sheet: "Sheet",
  table: "Table",
  timeline: "Timeline",
  url: "Link",
};

function ArtifactCard({ artifact: a, open, active }: { artifact: CallArtifact; open: (a: CallArtifact) => void; active: boolean }) {
  const external = !!a.target && "href" in a.target;
  const kind = a.label ?? KIND_LABEL[a.kind] ?? "Link";
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent">
        <KindIcon kind={a.kind} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14.5px] font-medium text-ink">{a.title}</span>
        <span className="truncate text-[12.5px] text-ink-3">
          {kind}
          {a.summary ? ` · ${a.summary}` : ""}
        </span>
      </span>
      {a.target && (
        <span aria-hidden className="shrink-0 text-ink-3 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-ink">
          {external ? "↗" : "›"}
        </span>
      )}
    </>
  );
  const frame = `flex w-full max-w-[520px] items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left ${active ? "border-accent bg-accent-soft/40" : "border-rule bg-surface"}`;
  if (!a.target) return <div className={`${frame} opacity-70`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => open(a)}
      title={external ? "Opens in a new tab" : `Open ${a.title}`}
      className={`${frame} group transition-[border-color,transform] duration-150 hover:border-rule-strong active:scale-[0.99]`}
    >
      {body}
    </button>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (kind === "app")
    return (
      <svg {...p}>
        <rect x="2.5" y="2.5" width="5" height="5" rx="1.2" />
        <rect x="10.5" y="2.5" width="5" height="5" rx="1.2" />
        <rect x="2.5" y="10.5" width="5" height="5" rx="1.2" />
        <rect x="10.5" y="10.5" width="5" height="5" rx="1.2" />
      </svg>
    );
  if (kind === "image" || kind === "video")
    return (
      <svg {...p}>
        <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
        <circle cx="6.5" cy="7.5" r="1.3" />
        <path d="M15.5 12l-4-4-6.5 6.5" />
      </svg>
    );
  if (kind === "pull_request" || kind === "diff")
    return (
      <svg {...p}>
        <circle cx="5" cy="4" r="1.6" />
        <circle cx="5" cy="14" r="1.6" />
        <circle cx="13" cy="14" r="1.6" />
        <path d="M5 5.6v6.8M13 12.4V7.5a2 2 0 0 0-2-2H8.5M10 3.8L8.3 5.5 10 7.2" />
      </svg>
    );
  if (kind === "sheet" || kind === "table" || kind === "timeline")
    return (
      <svg {...p}>
        <rect x="2.5" y="3" width="13" height="12" rx="2" />
        <path d="M2.5 7.5h13M2.5 11h13M7 7.5V15" />
      </svg>
    );
  if (kind === "url" || kind === "html")
    return (
      <svg {...p}>
        <path d="M7.5 10.5l3-3M6 8.5l-1.5 1.5a2.5 2.5 0 0 0 3.5 3.5l1.5-1.5M12 9.5l1.5-1.5a2.5 2.5 0 0 0-3.5-3.5L8.5 6" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5z" />
      <path d="M10.5 2.5v4h4M6.5 10h5M6.5 12.5h3.5" />
    </svg>
  );
}

/** Mute and End while the call is on; Talk again once it is over, with its transcript still there. */
function Controls({ call, risen }: { call: Call; risen: boolean }) {
  const shown = call.active || (risen && call.phase === "ended");
  return (
    <div
      className={`flex shrink-0 items-start justify-center gap-6 transition-[opacity,transform,padding] duration-500 ease-out-soft ${
        shown ? "translate-y-0 pt-2 pb-6 opacity-100 md:pb-8" : "pointer-events-none h-0 translate-y-3 overflow-hidden opacity-0"
      }`}
    >
      {call.active ? (
        <>
          <RoundButton
            label={call.microphone ? "Mute" : "Unmute"}
            hint="M"
            pressed={!call.microphone}
            disabled={call.phase !== "live"}
            onClick={call.toggleMicrophone}
            className={call.microphone ? "border border-rule-strong bg-surface text-ink hover:border-ink-3" : "bg-ink text-paper"}
          >
            <MicIcon off={!call.microphone} />
          </RoundButton>
          <RoundButton label="End" onClick={call.hangUp} className="bg-danger text-white hover:opacity-90">
            <HangUpIcon />
          </RoundButton>
        </>
      ) : (
        <button type="button" onClick={call.talk} className={`${buttonClass.primary} rounded-full px-6`}>
          <MicIcon />
          Talk again
        </button>
      )}
    </div>
  );
}

function RoundButton({
  label,
  hint,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        title={hint ? `${label} (${hint})` : label}
        className={`grid size-14 place-items-center rounded-full transition-[background-color,border-color,transform,opacity] duration-150 active:scale-[0.94] disabled:opacity-50 [&_svg]:size-[22px] ${className}`}
      >
        {children}
      </button>
      <span aria-hidden className="text-[12px] text-ink-3">
        {label}
      </span>
    </span>
  );
}

/**
 * What a card opened, through strut: its viewer for a file, or an app,
 * signed in as the person. Beside the call on a wide screen, over it on a
 * phone. Stadeum draws none of it.
 */
function Viewer({ viewing, close }: { viewing: Viewing; close: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLoaded(false);
    if (!viewing.src) return setSrc(undefined);
    const url = new URL(viewing.src);
    url.searchParams.set("theme", shownTheme());
    setSrc(url.toString());
  }, [viewing.src]);

  return (
    <aside
      aria-label={viewing.title}
      className="arrive fixed inset-0 z-40 flex flex-col bg-paper md:static md:inset-auto md:z-auto md:w-[min(50%,680px)] md:shrink-0 md:border-l md:border-rule"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-4">
        <p className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{viewing.title}</p>
        <button type="button" onClick={close} aria-label="Close" title="Close (Esc)" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-raised hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="relative flex-1">
        {viewing.error ? (
          <p className="grid h-full place-items-center px-6 text-center text-[14.5px] text-ink-3">{viewing.error}</p>
        ) : (
          <>
            {!loaded && <p className="absolute inset-0 grid place-items-center text-[14.5px] text-ink-3">Opening {viewing.title}…</p>}
            {src && (
              <iframe
                src={src}
                title={viewing.title}
                onLoad={() => setLoaded(true)}
                className={`absolute inset-0 size-full transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
                allow="clipboard-write"
                referrerPolicy="no-referrer"
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
