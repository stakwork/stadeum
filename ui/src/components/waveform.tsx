"use client";

import { useEffect, useRef } from "react";

/**
 * A call's waveform: a few rounded bars that say at a glance what the call
 * is doing, as Peel's Talk screen does.
 * - idle: a slow, quiet swell, the call ready to start;
 * - waiting (calling, connecting, getting ready): a breath;
 * - listening: the bars move with the person's microphone, in ink;
 * - speaking: they move with the assistant's voice, in the accent;
 * - thinking: a calm wave travels across;
 * - muted: they lie low and dim; ended: still.
 * Levels are read about sixty times a second from `levels()`, outside React.
 * They rise fast and fall slowly, and each bar wobbles at its own pace.
 * With reduced motion the bars keep their shape and only their size follows
 * the level.
 */
export type WaveMode = "idle" | "waiting" | "listening" | "speaking" | "thinking" | "muted" | "ended";

const BARS = 7;
/** Taller in the middle: each bar's share of the full height. */
const SHAPE = Array.from({ length: BARS }, (_, i) => 0.55 + 0.45 * Math.cos(((i - (BARS - 1) / 2) / ((BARS - 1) / 2)) * (Math.PI / 2.2)));

const tone: Record<WaveMode, string> = {
  idle: "bg-accent",
  waiting: "bg-accent",
  listening: "bg-ink-2",
  speaking: "bg-accent",
  thinking: "bg-accent",
  muted: "bg-ink-3 opacity-50",
  ended: "bg-ink-3 opacity-60",
};

export function Waveform({ mode, levels, height = 56 }: { mode: WaveMode; levels: () => { agent: number; you: number }; height?: number }) {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shown = new Array<number>(BARS).fill(0.15);
    let level = 0;
    let frame = 0;
    const min = 0.1;

    const draw = (now: number) => {
      const t = now / 1000;
      const m = modeRef.current;
      const calm = still.matches;
      const heard = m === "speaking" ? levelsRef.current().agent : m === "listening" ? levelsRef.current().you : 0;
      // Rises fast, falls slowly.
      level += (heard - level) * (heard > level ? 0.5 : 0.1);

      for (let i = 0; i < BARS; i++) {
        let want: number;
        switch (m) {
          case "speaking":
          case "listening":
            want = min + level * SHAPE[i]! * (calm ? 0.9 : 0.7 + 0.3 * Math.sin(t * (7 + i * 1.3) + i * 1.7));
            break;
          case "thinking":
            want = calm ? 0.3 * SHAPE[i]! : 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 4.2 - i * 0.85));
            break;
          case "waiting":
            want = calm ? 0.3 * SHAPE[i]! : (0.16 + 0.26 * (0.5 + 0.5 * Math.sin(t * 2.6 - i * 0.25))) * (0.6 + 0.4 * SHAPE[i]!);
            break;
          case "idle":
            want = calm ? 0.4 * SHAPE[i]! : (0.26 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.75))) * (0.55 + 0.45 * SHAPE[i]!) + 0.06;
            break;
          case "muted":
            want = 0.08;
            break;
          default:
            want = 0.12;
        }
        shown[i] = shown[i]! + (want - shown[i]!) * (calm ? 0.08 : 0.25);
        const el = bars.current[i];
        if (el) el.style.height = `${Math.max(4, Math.round(shown[i]! * height))}px`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [height]);

  return (
    <span aria-hidden className="flex items-center gap-[5px]" style={{ height }}>
      {SHAPE.map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className={`block w-[6px] rounded-full transition-[background-color,opacity] duration-500 ${tone[mode]}`}
          style={{ height: 6 }}
        />
      ))}
    </span>
  );
}
