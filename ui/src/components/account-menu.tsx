"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOutAction } from "@/app/(app)/actions";
import { Dot, dot, type Tone } from "./state";

export interface Person {
  name: string;
  email: string;
  role: string;
  tone: Tone;
  state: string;
}

function initials(name: string): string {
  const words = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

const menuItem =
  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink";

/**
 * The person at the foot of the rail: one row that opens a menu above it,
 * with their settings, the organisation's (admins) and sign out. Their AI
 * access shows as a dot on the avatar only when it is not ready.
 */
export function AccountMenu({ person, admin }: { person: Person; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          id="account-menu"
          role="menu"
          aria-label="Account"
          className="absolute right-0 bottom-full left-0 mb-2 flex flex-col gap-px rounded-xl border border-rule bg-surface p-1.5 shadow-soft"
        >
          <div className="mb-1 flex flex-col gap-0.5 border-b border-rule-soft px-2.5 pt-2 pb-3">
            <span className="truncate text-[14px] font-medium text-ink">{person.name}</span>
            <span className="truncate text-[12px] text-ink-3">{person.email}</span>
            {person.tone !== "ok" && (
              <span className="mt-2 text-[12px]">
                <Dot tone={person.tone} label={`AI access: ${person.state.toLowerCase()}`} />
              </span>
            )}
          </div>
          <Link role="menuitem" href="/me" className={menuItem}>
            <PersonIcon />
            Your settings
          </Link>
          {admin && (
            <Link role="menuitem" href="/members" className={menuItem}>
              <OrgIcon />
              Organisation
            </Link>
          )}
          <div className="my-1 h-px bg-rule-soft" />
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className={`${menuItem} w-full`}>
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "account-menu" : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left transition-colors duration-150 hover:bg-raised ${open ? "bg-raised" : ""}`}
      >
        <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-semibold text-ink-2 ring-1 ring-rule">
          {initials(person.name)}
          {person.tone !== "ok" && (
            <span
              aria-label={`AI access: ${person.state}`}
              className={`absolute -right-px -bottom-px size-[9px] rounded-full ring-2 ring-paper ${person.tone === "attention" ? "bg-warn" : `bg-paper ${dot[person.tone]}`}`}
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium text-ink">{person.name}</span>
          <span className="text-[12px] text-ink-3">{person.role}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-3"
          aria-hidden
        >
          <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
        </svg>
      </button>
    </div>
  );
}

const icon = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PersonIcon() {
  return (
    <svg {...icon}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.8-2.3 2.7-3.5 5-3.5s4.2 1.2 5 3.5" />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg {...icon}>
      <path d="M2.5 13.5h11M3.5 13.5V6l4.5-3 4.5 3v7.5M6.5 13.5v-3h3v3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg {...icon}>
      <path d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13.5 8H6.5" />
    </svg>
  );
}
