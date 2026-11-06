"use client";

import { buttonClass } from "@/components/button";
import { HangUpIcon, MicIcon, callStatus, useCall, useClock, type Call } from "@/components/call";
import { callDuration } from "@/lib/calls";

/** The call, large: Talk, what it is doing, Mute and Hang up, and why it stopped. */
export function CallPanel() {
  const call = useCall();
  const now = useClock(call.phase === "live");
  const notices = Object.values(call.notices);

  return (
    <section aria-label={`Call with ${call.assistant}`} className="flex max-w-3xl flex-col gap-3">
      <div className="flex flex-col items-center gap-6 rounded-[14px] border border-rule bg-surface px-5 py-10 text-center shadow-soft md:px-10 md:py-14">
        <Orb call={call} />

        <div className="flex min-h-[52px] flex-col items-center gap-1" aria-live="polite">
          {call.active ? (
            <>
              <p className="font-serif text-[26px] leading-tight text-ink">{callStatus(call)}</p>
              <p className="text-[14px] text-ink-3 tabular-nums">
                {call.liveSince ? callDuration(now - call.liveSince) : `with ${call.assistant}`}
              </p>
            </>
          ) : call.phase === "ended" ? (
            <>
              <p className="font-serif text-[26px] leading-tight text-ink">
                Call ended{call.ended?.after != null ? ` · ${callDuration(call.ended.after)}` : ""}
              </p>
              <p className="text-[14px] text-ink-3">{call.ended?.reason ?? "You hung up."}</p>
            </>
          ) : (
            <>
              <p className="font-serif text-[26px] leading-tight text-ink">Talk to {call.assistant}</p>
              <p className="text-[14px] text-ink-3">Ask, think out loud, hand over a task.</p>
            </>
          )}
        </div>

        {call.error && (
          <p role="alert" className="max-w-md rounded-lg bg-warn-soft px-4 py-3 text-[14px] text-warn">
            {call.error}
          </p>
        )}

        {notices.length > 0 && (
          <div role="alert" className="flex max-w-md flex-col gap-2">
            {notices.map((n) => (
              <p key={n} className="rounded-lg bg-warn-soft px-4 py-3 text-[14px] text-warn">
                {n}
                {n === call.notices.audio && (
                  <button type="button" onClick={call.startAudio} className="ml-2 font-medium underline underline-offset-2">
                    Play
                  </button>
                )}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          {call.active ? (
            <>
              <button type="button" onClick={call.toggleMicrophone} disabled={call.phase !== "live"} className={buttonClass.secondary}>
                <MicIcon off={!call.microphone} />
                {call.microphone ? "Mute" : "Unmute"}
              </button>
              <button type="button" onClick={call.hangUp} className={`${buttonClass.secondary} text-danger`}>
                <HangUpIcon />
                Hang up
              </button>
            </>
          ) : (
            <button type="button" onClick={call.talk} className={buttonClass.primary}>
              <MicIcon />
              {call.phase === "ended" ? "Talk again" : "Talk"}
            </button>
          )}
        </div>
      </div>
      <p className="max-w-2xl text-[13px] leading-relaxed text-ink-3">
        End-to-end encrypted with a key made for this call: the call server carries audio it can’t read. What you say goes into your conversation
        with {call.assistant}.
      </p>
    </section>
  );
}

/** A circle that says the call's state at a glance; still when motion is reduced. */
function Orb({ call }: { call: Call }) {
  const live = call.phase === "live";
  const speaking = live && call.agent === "speaking";
  const waiting = call.phase === "starting" || call.phase === "connecting" || call.phase === "reconnecting" || (live && call.agent === "thinking");
  const tone = live ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent";
  return (
    <div aria-hidden className="relative grid size-28 place-items-center">
      {speaking && <span className="absolute inset-0 rounded-full bg-ok-soft motion-safe:animate-ping" />}
      <span
        className={`relative grid size-28 place-items-center rounded-full transition-colors duration-300 ${tone} ${waiting ? "motion-safe:animate-pulse" : ""} ${
          live && !call.microphone ? "opacity-60" : ""
        }`}
      >
        <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
          {live && !call.microphone && <path d="M2 2l12 12" />}
        </svg>
      </span>
    </div>
  );
}
