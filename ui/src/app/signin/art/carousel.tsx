"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Contours } from "./contours";
import { Converge } from "./converge";
import { LogoMark } from "@/components/logo-mark";

const STORAGE_KEY = "stadeum.signin.art";

interface Artwork {
  name: string;
  /** Panel background. Converge deepens in dark mode through `--art`. */
  background: string;
  text: string;
  subline: string;
  Art: (props: { active: boolean }) => React.ReactNode;
}

const ARTWORKS: Artwork[] = [
  { name: "Converge", background: "var(--art, #23436B)", text: "#F6F4EE", subline: "#D9E1EC", Art: Converge },
  { name: "Contours", background: "#ECE6D8", text: "#1B1A17", subline: "#4A463E", Art: Contours },
];

const COUNT = ARTWORKS.length;
const clamp = (i: number) => Math.min(COUNT - 1, Math.max(0, i));

/**
 * The sign-in art panel: two artworks side by side, one in view. Drag or
 * swipe (touch, mouse, trackpad), arrow keys when focused, or the dots.
 * The row does not wrap: with two slides, the one neighbour cannot sit on
 * both sides at once.
 * Slides move by transform only and reverse cleanly mid-flight. The text
 * layers cross-fade so each artwork keeps its own ink.
 */
export function ArtCarousel() {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [animate, setAnimate] = useState(false);
  // Neighbours are drawn only while something moves; at rest they would show as a sub-pixel seam.
  const [moving, setMoving] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const move = useCallback(() => {
    setMoving(true);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setMoving(false), 300);
  }, []);
  const panel = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number; id: number; t: number; horizontal: boolean | null } | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isInteger(saved) && saved >= 0 && saved < COUNT) setIndex(saved);
    } catch {
      // Storage blocked: start on Converge.
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(index));
    } catch {
      // Not remembered.
    }
  }, [index]);

  const go = useCallback(
    (next: number) => {
      move();
      setAnimate(true);
      setDrag(0);
      setIndex(clamp(next));
    },
    [move],
  );

  // Trackpad: a horizontal two-finger swipe arrives as wheel deltaX.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let acc = 0;
    let lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (performance.now() < lockedUntil) return;
      acc += e.deltaX;
      if (Math.abs(acc) > 60) {
        move();
        setIndex((i) => clamp(i + Math.sign(acc)));
        setAnimate(true);
        acc = 0;
        lockedUntil = performance.now() + 450;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [move]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now(), horizontal: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.horizontal === null && Math.hypot(dx, dy) > 6) {
      s.horizontal = Math.abs(dx) > Math.abs(dy);
      if (s.horizontal) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        clearTimeout(settle.current);
        setMoving(true);
        setDragging(true);
      } else {
        start.current = null;
        return;
      }
    }
    // Past either end there is nothing to reveal: resist instead.
    if (s.horizontal) setDrag(clamp(index - Math.sign(dx)) === index ? dx / 4 : dx);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !s.horizontal) return;
    setDragging(false);
    const width = panel.current?.clientWidth ?? 1;
    const dx = e.clientX - s.x;
    const velocity = dx / Math.max(1, performance.now() - s.t);
    if (Math.abs(dx) > width * 0.18 || Math.abs(velocity) > 0.5) go(index - Math.sign(dx));
    else {
      move();
      setAnimate(true);
      setDrag(0);
    }
  };

  const slideMotion = animate && !dragging ? "transition-transform duration-[250ms] ease-out-soft motion-reduce:transition-none" : "";
  const fadeMotion = "transition-opacity duration-[250ms] ease-out-soft";

  return (
    <section
      ref={panel}
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label="Artwork"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        else if (e.key === "ArrowLeft") go(index - 1);
        else return;
        e.preventDefault();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className="relative h-[200px] shrink-0 cursor-grab touch-pan-y overflow-hidden outline-none select-none active:cursor-grabbing md:h-auto md:min-h-dvh md:flex-[1_1_560px]"
    >
      {ARTWORKS.map((a, i) => {
        const offset = i - index;
        const shown = offset === 0 || (moving && Math.abs(offset) <= 1);
        return (
          <div
            key={a.name}
            aria-hidden={i !== index}
            className={`absolute inset-0 ${slideMotion} ${shown ? "" : "invisible"}`}
            style={{ background: a.background, transform: `translateX(calc(${offset * 100}% + ${drag}px))` }}
          >
            <a.Art active={i === index} />
          </div>
        );
      })}

      {/* One text layer per artwork, cross-faded so each keeps its own colours. */}
      {ARTWORKS.map((a, i) => (
        <div
          key={a.name}
          aria-hidden={i !== index}
          className={`pointer-events-none absolute inset-0 flex flex-col justify-between px-4 pt-5 pb-6 md:px-12 md:pt-10 md:pb-14 ${fadeMotion} ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
          style={{ color: a.text }}
        >
          <span className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="font-serif text-[22px] leading-none tracking-[-0.02em] md:text-[26px]">stadeum</span>
          </span>
          <div className="flex max-w-[460px] flex-col gap-3.5">
            {i === index ? (
              <h1 className="font-serif text-[26px] leading-[1.05] font-normal tracking-[-0.025em] md:text-[52px]">
                Your team&rsquo;s private AI workspace.
              </h1>
            ) : (
              <p className="font-serif text-[26px] leading-[1.05] font-normal tracking-[-0.025em] md:text-[52px]">
                Your team&rsquo;s private AI workspace.
              </p>
            )}
            <p className="hidden text-[17px] leading-relaxed md:block" style={{ color: a.subline }}>
              Turn your team&rsquo;s private knowledge into workflows and apps, all in one place.
            </p>
          </div>
        </div>
      ))}

      <div className="absolute top-4 right-4 flex gap-1 md:top-auto md:right-6 md:bottom-6">
        {ARTWORKS.map((a, i) => (
          <button
            key={a.name}
            type="button"
            aria-label={`Artwork ${i + 1} of ${COUNT}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => go(i)}
            className="grid size-6 place-items-center rounded-full"
          >
            <span
              aria-hidden
              className={`block size-1.5 rounded-full transition-opacity duration-150 ${i === index ? "opacity-90" : "opacity-35 hover:opacity-60"}`}
              style={{ background: ARTWORKS[index]!.text }}
            />
          </button>
        ))}
      </div>
    </section>
  );
}
