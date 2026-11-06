"use client";

import { useActionState, useState } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass, FormNote, Submit } from "@/components/form";
import { RESETS, resetLabel, type Reset } from "@/lib/spend/rules";
import { saveDefaults, setPersonLimit, type Result } from "./actions";

/** Everyone's limit and how often it resets. */
export function DefaultsForm({ limit, reset }: { limit: number; reset: Reset }) {
  const [state, action] = useActionState<Result, FormData>(saveDefaults, {});
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-[14px] border border-rule bg-surface p-5 shadow-soft md:p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="limit" className="text-[13px] font-medium text-ink">
            Each person’s limit
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] text-ink-3"
            >
              $
            </span>
            <input
              id="limit"
              name="limit"
              inputMode="decimal"
              defaultValue={limit}
              className={`${fieldClass} pl-7 tabular-nums`}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="reset" className="text-[13px] font-medium text-ink">
            Resets
          </label>
          <select id="reset" name="reset" defaultValue={reset} className={fieldClass}>
            {RESETS.map((r) => (
              <option key={r} value={r}>
                {resetLabel[r]}
              </option>
            ))}
          </select>
        </div>
        <Submit className={buttonClass.primary} pendingLabel="Saving…">
          Save
        </Submit>
      </div>
      <FormNote state={state}>
        For everyone without their own limit. The gateway stops a person’s calls at their limit.
      </FormNote>
    </form>
  );
}

/** A person's limit in the table: what it is, and an Edit that sets their own or puts them back on everyone's. */
export function PersonLimit({
  userId,
  name,
  ownLimit,
  defaultLimit,
}: {
  userId: string;
  name: string;
  ownLimit: number | null;
  defaultLimit: number;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<Result, FormData>(async (prev, form) => {
    const r = await setPersonLimit(userId, prev, form);
    if (!r.error) setEditing(false);
    return r;
  }, {});

  if (!editing) {
    return (
      <span className="flex items-center justify-end gap-1">
        {state.error && <span className="text-[12px] text-warn">{state.error}</span>}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${name}’s limit`}
          className="rounded-md px-2 py-1 text-[13px] text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <form action={action} className="flex items-center justify-end gap-1.5">
      <label htmlFor={`own-${userId}`} className="sr-only">
        {name}’s limit in dollars
      </label>
      <span className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-ink-3"
        >
          $
        </span>
        <input
          id={`own-${userId}`}
          name="limit"
          inputMode="decimal"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          defaultValue={ownLimit ?? ""}
          placeholder={String(defaultLimit)}
          className="h-8 w-24 rounded-lg border border-rule-strong bg-surface pr-2 pl-6 text-[13px] text-ink tabular-nums focus:border-ink-3 focus:outline-none"
        />
      </span>
      <Submit
        className="h-8 rounded-lg bg-accent px-2.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover"
        pendingLabel="…"
      >
        Save
      </Submit>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="h-8 rounded-lg px-2 text-[13px] text-ink-3 hover:text-ink"
      >
        Cancel
      </button>
      {state.error && <span className="text-[12px] text-warn">{state.error}</span>}
    </form>
  );
}
