"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { CallRoom, NoticeKind } from "@/lib/call-room";
import { EMPTY_TRANSCRIPT, receiveArtifacts, receiveChunk, type Transcript } from "@/lib/call-transcript";
import { agentStateLabel, callDuration, newCallKey, readCallAnswer, refusalMessage } from "@/lib/calls";

/**
 * A voice call with the assistant (AGENTS.md rule 2: the one thing stadeum
 * draws besides its own pages, because a strut app's frame cannot carry
 * live media). It is held here, in the `(app)` layout, so it keeps going
 * while the person moves between stadeum's pages, the framed apps among
 * them. The page knows a call, never a conversation, a run or a job: what
 * is said lands in the assistant's conversation through strut. The live
 * transcript and the artifacts handed over are the call's own, in memory:
 * shown until the next call, never kept.
 */

export type CallPhase = "idle" | "starting" | "connecting" | "live" | "reconnecting" | "ended";

export interface CallState {
  phase: CallPhase;
  /** The agent's state attribute, or null while it is not in the room. */
  agent: string | null;
  microphone: boolean;
  /** Why the last call could not start, in plain words. */
  error: string | null;
  notices: Partial<Record<NoticeKind, string>>;
  /** When the call went live (ms), for its clock. */
  liveSince: number | null;
  /** An ended call: how long it was live, and why it ended when not by the person's hand. */
  ended: { after: number | null; reason: string | null } | null;
  /** What both sides said, and what the assistant handed over (lib/call-transcript.ts). */
  transcript: Transcript;
}

export interface Call extends CallState {
  /** Who a call is with: the assistant's title. */
  assistant: string;
  /** A call is on its way or on. */
  active: boolean;
  talk(): void;
  hangUp(): void;
  toggleMicrophone(): void;
  startAudio(): void;
  /** How loud each side is now, 0…1: read on the waveform's own clock, so nothing re-renders for it. */
  levels(): { agent: number; you: number };
}

const IDLE: CallState = { phase: "idle", agent: null, microphone: false, error: null, notices: {}, liveSince: null, ended: null, transcript: EMPTY_TRANSCRIPT };
const SILENT = { agent: 0, you: 0 };

const CallContext = createContext<Call | null>(null);

export function useCall(): Call {
  const call = useContext(CallContext);
  if (!call) throw new Error("useCall outside CallProvider");
  return call;
}

export const isActive = (phase: CallPhase) => phase !== "idle" && phase !== "ended";

export function CallProvider({ assistant, children }: { assistant: string; children: React.ReactNode }) {
  const [state, setState] = useState<CallState>(IDLE);
  const room = useRef<CallRoom | null>(null);
  // Each call gets a number; a hang-up moves it on, so a call still on its
  // way when the person hung up is left the moment it arrives.
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((id: number, change: (s: CallState) => CallState) => {
    if (id === generation.current) setState(change);
  }, []);

  const endCall = useCallback((reason: string | null) => {
    generation.current += 1;
    const r = room.current;
    room.current = null;
    void r?.leave();
    // The transcript stays to read, and its artifacts to open, until the next call.
    setState((s) => ({ ...IDLE, phase: "ended", transcript: s.transcript, ended: { after: s.liveSince ? Date.now() - s.liveSince : null, reason } }));
  }, []);

  const talk = useCallback(() => {
    if (isActive(stateRef.current.phase)) return;
    const id = ++generation.current;
    setState({ ...IDLE, phase: "starting" });
    const fail = (error: string) => update(id, () => ({ ...IDLE, error }));

    void (async () => {
      // Loaded on the first call: livekit-client stays out of every page.
      const lk = await import("@/lib/call-room").catch(() => null);
      if (!lk) return fail("The call couldn’t load. Reload the page and try again.");
      if (!lk.canEncrypt()) return fail("This browser can’t make an end-to-end encrypted call. Use a current Chrome, Edge, Firefox or Safari.");

      const key = newCallKey();
      let res: Response;
      try {
        res = await fetch("/api/calls", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // `artifacts`: this page shows what the assistant hands over, so it may say "on your screen".
          body: JSON.stringify({ key, artifacts: true }),
          cache: "no-store",
        });
      } catch {
        return fail("Stadeum isn’t answering. Check your connection and try again.");
      }
      const data = (await res.json().catch(() => null)) as unknown;
      if (id !== generation.current) return;
      if (!res.ok) return fail(refusalMessage(res.status, data, assistant));
      const read = readCallAnswer(data);
      if (!read.ok) return fail(read.error);

      update(id, (s) => ({ ...s, phase: "connecting" }));
      let joined: CallRoom;
      try {
        joined = await lk.joinCallRoom(read.answer, key, assistant, {
          connection: (c) =>
            update(id, (s) =>
              c === "connected"
                ? { ...s, phase: "live", liveSince: s.liveSince ?? Date.now() }
                : { ...s, phase: c === "reconnecting" ? "reconnecting" : s.liveSince ? s.phase : "connecting" },
            ),
          agent: (agent) => update(id, (s) => ({ ...s, agent })),
          microphone: (microphone) => update(id, (s) => ({ ...s, microphone })),
          notice: (kind, text) =>
            update(id, (s) => {
              if ((s.notices[kind] ?? null) === text) return s;
              const notices = { ...s.notices };
              if (text) notices[kind] = text;
              else delete notices[kind];
              return { ...s, notices };
            }),
          words: (chunk) => update(id, (s) => ({ ...s, transcript: receiveChunk(s.transcript, chunk) })),
          artifacts: (text) => update(id, (s) => ({ ...s, transcript: receiveArtifacts(s.transcript, text) })),
          ended: (reason) => {
            if (id === generation.current) endCall(reason);
          },
        });
      } catch {
        return fail("The call server couldn’t be reached. Try again in a moment.");
      }
      if (id !== generation.current) return void joined.leave();
      room.current = joined;
    })();
  }, [assistant, endCall, update]);

  const hangUp = useCallback(() => {
    if (isActive(stateRef.current.phase)) endCall(null);
  }, [endCall]);

  const toggleMicrophone = useCallback(() => {
    void room.current?.setMicrophone(!stateRef.current.microphone);
  }, []);

  const startAudio = useCallback(() => {
    void room.current?.startAudio();
  }, []);

  const levels = useCallback(() => room.current?.levels() ?? SILENT, []);

  // Leaving stadeum (a full reload, signing out) hangs up.
  useEffect(() => () => void room.current?.leave(), []);

  const call = useMemo<Call>(
    () => ({ ...state, assistant, active: isActive(state.phase), talk, hangUp, toggleMicrophone, startAudio, levels }),
    [state, assistant, talk, hangUp, toggleMicrophone, startAudio, levels],
  );
  return <CallContext.Provider value={call}>{children}</CallContext.Provider>;
}

/** The time now, once a second while `on`. */
export function useClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** What a call is doing, in a few words. */
export function callStatus(call: Call): string {
  switch (call.phase) {
    case "starting":
      return `Calling ${call.assistant}…`;
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "live":
      return agentStateLabel(call.agent, call.assistant);
    default:
      return "";
  }
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg {...iconProps}>
      <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
      {off && <path d="M2 2l12 12" />}
    </svg>
  );
}

export function HangUpIcon() {
  return (
    <svg {...iconProps}>
      <path d="M1.75 9.25c3.5-3.25 9-3.25 12.5 0l-1.5 1.75-2.5-1v-1.75a7 7 0 0 0-4.5 0V10l-2.5 1z" />
    </svg>
  );
}

/**
 * The call while the person is elsewhere in stadeum: in the rail, never
 * over a page, so it covers nothing of a framed app. `compact` is the
 * phone's top bar.
 */
export function CallRailCard({ compact }: { compact?: boolean }) {
  const call = useCall();
  const now = useClock(call.phase === "live");
  if (!call.active) return null;
  const clock = call.liveSince ? callDuration(now - call.liveSince) : null;
  const status = callStatus(call);

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <Link href="/calls" className="flex h-9 items-center gap-1.5 rounded-full bg-ok-soft px-3 text-[13px] font-medium text-ok" aria-label={`On a call with ${call.assistant}: ${status}`}>
          <span aria-hidden className="size-[7px] rounded-full bg-ok" />
          {clock ?? "Call"}
        </Link>
        <button type="button" onClick={call.hangUp} aria-label="Hang up" className="grid size-9 place-items-center rounded-full text-danger hover:bg-raised">
          <HangUpIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rule bg-surface p-3" role="region" aria-label={`Call with ${call.assistant}`}>
      <Link href="/calls" className="flex items-center justify-between gap-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-ok">
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-ok" />
          <span className="truncate">{call.assistant}</span>
        </span>
        {clock && <span className="text-ink-3 tabular-nums">{clock}</span>}
      </Link>
      <span className="text-[12.5px] text-ink-2" aria-live="polite">
        {status}
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={call.toggleMicrophone}
          disabled={call.phase !== "live"}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-rule-strong text-[12.5px] text-ink hover:border-ink-3 disabled:opacity-50"
        >
          <MicIcon off={!call.microphone} />
          {call.microphone ? "Mute" : "Unmute"}
        </button>
        <button type="button" onClick={call.hangUp} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12.5px] text-danger hover:bg-raised">
          <HangUpIcon />
          Hang up
        </button>
      </div>
    </div>
  );
}
