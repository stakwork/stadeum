"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass } from "@/components/button";
import type { Role } from "@/lib/roles";
import { changeRole, invite, removeMember, revokeInvite, type FormState } from "./actions";

const field =
  "h-11 w-full rounded-[10px] border border-rule-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none";

function Submit({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {children}
    </button>
  );
}

export function InviteForm({ domainNote, placeholderDomain }: { domainNote?: React.ReactNode; placeholderDomain: string }) {
  const [state, action] = useActionState<FormState, FormData>(invite, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <label htmlFor="invite-email" className="text-[13px] font-medium text-ink">
          Invite by email
        </label>
        <input id="invite-email" name="email" type="email" required placeholder={`name@${placeholderDomain}`} className={field} />
      </div>
      <div className="flex flex-[0_1_160px] flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-[13px] font-medium text-ink">
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="member" className={`${field} px-3`}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Submit className={buttonClass.primary}>Send invite</Submit>
      <p aria-live="polite" className="mt-1 basis-full text-[13px] text-ink-3">
        {state.error ? (
          <span className="text-warn">{state.error}</span>
        ) : state.ok ? (
          <span className="text-ok">{state.ok}</span>
        ) : (
          domainNote
        )}
      </p>
    </form>
  );
}

/**
 * The ⋯ menu for one row. It opens beside its trigger, closes on Escape
 * or an outside click, and asks before removing anyone.
 */
export function RowMenu(
  props:
    | { kind: "member"; id: string; name: string; role: Role }
    | { kind: "invite"; id: string; email: string },
) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Fixed to the trigger's corner, so the table's scroll box never clips it.
  function toggle() {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
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

  const label = props.kind === "member" ? `Options for ${props.name}` : `Options for the invite to ${props.email}`;
  const item = "flex h-9 w-full items-center rounded-md px-3 text-left text-[14px] text-ink hover:bg-raised";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={trigger}
        onClick={toggle}
        className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      <div
        role="menu"
        hidden={!open}
        style={pos ? { top: pos.top, right: pos.right } : undefined}
        className="menu-pop fixed z-20 w-56 origin-top-right rounded-[10px] border border-rule bg-surface p-1 shadow-soft"
      >
        {props.kind === "invite" ? (
          <form action={revokeInvite} onSubmit={() => setOpen(false)}>
            <input type="hidden" name="id" value={props.id} />
            <button type="submit" role="menuitem" className={item}>
              Revoke invite
            </button>
          </form>
        ) : confirming ? (
          <form action={removeMember} className="flex flex-col gap-1 p-2">
            <input type="hidden" name="id" value={props.id} />
            <p className="pb-1 text-[13px] text-ink-2">Remove {props.name}?</p>
            <div className="flex gap-1">
              <button type="button" onClick={() => setConfirming(false)} className={buttonClass.quiet}>
                Keep
              </button>
              <Submit className={buttonClass.danger}>Remove</Submit>
            </div>
          </form>
        ) : (
          <>
            <form action={changeRole} onSubmit={() => setOpen(false)}>
              <input type="hidden" name="id" value={props.id} />
              <input type="hidden" name="role" value={props.role === "admin" ? "member" : "admin"} />
              <button type="submit" role="menuitem" className={item}>
                {props.role === "admin" ? "Make member" : "Make admin"}
              </button>
            </form>
            <button type="button" role="menuitem" onClick={() => setConfirming(true)} className={`${item} text-danger`}>
              Remove from organisation
            </button>
          </>
        )}
      </div>
    </div>
  );
}
