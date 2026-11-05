"use client";

import { useFormStatus } from "react-dom";

/** Form parts the admin pages share: the field style, a submit that waits, and the line under a form. */

export const fieldClass =
  "h-11 w-full rounded-[10px] border border-rule-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none";

export function Submit({ children, className, pendingLabel }: { children: React.ReactNode; className: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormNote({ state, children }: { state: { ok?: string; error?: string }; children?: React.ReactNode }) {
  return (
    <p aria-live="polite" className="text-[13px] text-ink-3">
      {state.error ? <span className="text-warn">{state.error}</span> : state.ok ? <span className="text-ok">{state.ok}</span> : children}
    </p>
  );
}

export function Labelled({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}
