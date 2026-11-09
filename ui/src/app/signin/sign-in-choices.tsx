"use client";

import { useEffect, useRef, useState } from "react";

import { buttonClass } from "@/components/button";

const STORAGE_KEY = "stadeum.signin.dev";

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect width="7" height="7" fill="#F25022" />
      <rect x="9" width="7" height="7" fill="#7FBA00" />
      <rect y="9" width="7" height="7" fill="#00A4EF" />
      <rect x="9" y="9" width="7" height="7" fill="#FFB900" />
    </svg>
  );
}

/**
 * The provider buttons, or (with the dev switch on) an email field in the
 * same space. Both panes share one grid cell, so the card keeps the height
 * of the taller one and nothing below it moves when they swap.
 */
export function SignInChoices({
  microsoft,
  google,
  dev,
  devAvailable,
  next,
}: {
  microsoft: (form: FormData) => Promise<void>;
  google: (form: FormData) => Promise<void>;
  dev: (form: FormData) => Promise<void>;
  devAvailable: boolean;
  /** The page to come back to after sign-in. */
  next?: string;
}) {
  const back = next ? <input type="hidden" name="next" value={next} /> : null;
  const [devOn, setDevOn] = useState(false);
  // Only a toggle animates; restoring the saved state on load just shows it.
  const [animate, setAnimate] = useState(false);
  // The switch's ring follows the keyboard only: never on load, a click, or a programmatic focus.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) setKeyboard(true);
    };
    const onPointer = () => setKeyboard(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);
  const email = useRef<HTMLInputElement>(null);
  const userToggled = useRef(false);

  // Restored after mount, so the server render (always the providers) matches the first client render.
  useEffect(() => {
    if (!devAvailable) return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setDevOn(true);
    } catch {
      // Storage blocked: start with the providers.
    }
  }, [devAvailable]);

  useEffect(() => {
    if (devOn) email.current?.focus();
    if (!userToggled.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, devOn ? "1" : "0");
    } catch {
      // Not remembered; the switch still works for this visit.
    }
  }, [devOn]);

  const showDev = devAvailable && devOn;
  const pane = `col-start-1 row-start-1 flex flex-col gap-3 ${
    animate ? "transition-[opacity,transform] duration-200 ease-out-soft motion-reduce:transition-opacity" : ""
  }`;
  const shown = "opacity-100 translate-y-0";
  const hidden = "pointer-events-none opacity-0 translate-y-1 motion-reduce:translate-y-0";

  return (
    <>
      <div className="grid">
        <div className={`${pane} ${showDev ? hidden : shown}`} inert={showDev} aria-hidden={showDev}>
          <form action={microsoft}>
            {back}
            <button type="submit" data-ink-button className={`${buttonClass.ink} h-12 w-full gap-3`}>
              <MicrosoftMark />
              Continue with Microsoft
            </button>
          </form>
          <form action={google}>
            {back}
            <button type="submit" className={`${buttonClass.secondary} h-12 w-full`}>
              Continue with Google
            </button>
          </form>
        </div>

        {devAvailable && (
          <form action={dev} className={`${pane} ${showDev ? shown : hidden}`} inert={!showDev} aria-hidden={!showDev}>
            {back}
            <label htmlFor="dev-email" className="sr-only">
              Email
            </label>
            <input
              ref={email}
              id="dev-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="Email"
              className="h-12 rounded-[10px] border border-rule-strong bg-surface px-3.5 text-[15px] placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
            />
            <button type="submit" data-ink-button className={`${buttonClass.ink} h-12 w-full`}>
              Continue
            </button>
          </form>
        )}
      </div>

      {devAvailable && (
        <button
          type="button"
          role="switch"
          aria-checked={devOn}
          data-own-ring
          onClick={() => {
            userToggled.current = true;
            setAnimate(true);
            setDevOn((on) => !on);
          }}
          className={`mt-6 inline-flex items-center gap-2 self-start rounded-full px-1 py-1 text-[12px] text-ink-3 outline-none hover:text-ink-2 ${
            keyboard ? "focus-visible:ring-2 focus-visible:ring-accent" : ""
          }`}
        >
          <span
            aria-hidden
            className={`relative inline-block h-4 w-7 rounded-full transition-colors duration-150 ${devOn ? "bg-ink-3" : "bg-rule-strong"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-[var(--knob,var(--surface))] transition-transform duration-150 ease-out ${devOn ? "translate-x-3" : ""}`}
            />
          </span>
          Dev
        </button>
      )}
    </>
  );
}
