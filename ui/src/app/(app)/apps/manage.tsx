"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass } from "@/components/form";
import { Modal } from "@/components/modal";
import type { LiveTarget } from "@/lib/strut/client";
import { makeLive, pin, remove, type ChangeResult } from "./actions";

const small =
  "inline-flex h-8 items-center justify-center rounded-lg border border-rule-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink-3 disabled:pointer-events-none disabled:opacity-50";

/**
 * A change to what everyone gets: the button opens a confirmation beside
 * it that says what everyone will get, and nothing happens until it is
 * confirmed. A refusal shows in strut's words; a refused Restore offers
 * to make that version live as it is now.
 */
function Confirm(props: {
  label: string;
  note: string;
  confirmLabel: string;
  run: () => Promise<ChangeResult>;
  runInstead?: (version: string) => Promise<ChangeResult>;
  pressed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ChangeResult>({});
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Fixed to the trigger's corner, so a table's scroll box never clips it.
  function toggle() {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setResult({});
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const go = (run: () => Promise<ChangeResult>) =>
    start(async () => {
      const r = await run();
      setResult(r);
      if (!r.error) setOpen(false);
    });

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        ref={trigger}
        onClick={toggle}
        aria-expanded={open}
        aria-pressed={props.pressed}
        className={`${small} ${props.pressed ? "border-ok text-ok" : ""}`}
      >
        {props.label}
      </button>
      <div
        role="dialog"
        aria-label={props.confirmLabel}
        hidden={!open}
        style={pos ? { top: pos.top, right: pos.right } : undefined}
        className="menu-pop fixed z-20 flex w-80 origin-top-right flex-col gap-3 rounded-[12px] border border-rule bg-surface p-4 text-left shadow-soft"
      >
        <p className="text-[13.5px] leading-snug text-ink-2">{props.note}</p>
        {result.error && <p className="text-[13px] leading-snug text-warn">{result.error}</p>}
        <div className="flex flex-wrap justify-end gap-1.5">
          <button type="button" onClick={() => setOpen(false)} className={buttonClass.quiet}>
            Cancel
          </button>
          {result.instead && props.runInstead ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => go(() => props.runInstead!(result.instead!))}
              className={`${buttonClass.primary} h-9 px-3 text-[14px]`}
            >
              Make {result.instead} live as it is now
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => go(props.run)} className={`${buttonClass.primary} h-9 px-3 text-[14px]`}>
              {props.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pin the app to the rail, or take it out. */
export function PinToggle({ name, pinned, note }: { name: string; pinned: boolean; note: string }) {
  return (
    <Confirm
      label={pinned ? "Pinned" : "Pin"}
      pressed={pinned}
      note={note}
      confirmLabel={pinned ? "Unpin" : "Pin"}
      run={() => pin(name, !pinned)}
    />
  );
}

/** Unpublish the app: a modal whose Delete waits until the app's name is typed. */
export function DeleteApp({ name, title }: { name: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const matches = typed.trim() === name;

  const close = () => {
    setOpen(false);
    setTyped("");
    setError(undefined);
  };
  const run = () =>
    start(async () => {
      const r = await remove(name);
      if (r.error) return setError(r.error);
      close();
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={small}>
        Delete
      </button>
      {open && (
        <Modal label={`Delete ${title}`} onClose={pending ? () => {} : close}>
          <h2 className="text-[19px] font-medium">Delete {title}?</h2>
          <p className="text-[14px] text-ink-2">It’s unpublished for everyone and leaves the rail. This can’t be undone from here.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (matches && !pending) run();
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delete-app-name" className="text-[13.5px] text-ink-2">
                Type <span className="font-mono text-ink select-all">{name}</span> to confirm
              </label>
              <input
                id="delete-app-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={pending}
                className={`${fieldClass} font-mono`}
              />
            </div>
            {error && (
              <p role="alert" className="text-[13.5px] text-warn">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-1.5">
              <button type="button" disabled={pending} onClick={close} className={buttonClass.quiet}>
                Cancel
              </button>
              <button type="submit" disabled={!matches || pending} className={`${buttonClass.primary} h-9 px-4 text-[14px]`}>
                {pending ? "Deleting…" : "Delete app"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Make a version live, restore one that was, or follow every publish again. */
export function LiveChange(props: { name: string; label: string; note: string; confirmLabel: string; target: LiveTarget; restores?: string }) {
  const { name, target, restores } = props;
  return (
    <Confirm
      label={props.label}
      note={props.note}
      confirmLabel={props.confirmLabel}
      run={() => makeLive(name, target, restores)}
      runInstead={(version) => makeLive(name, { version })}
    />
  );
}
