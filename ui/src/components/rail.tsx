"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Dot, type Tone } from "./state";
import { ThemeSegments } from "./theme-switch";
import { LogoMark } from "./logo-mark";

export interface RailProps {
  orgName: string;
  /** The top item, `/`: the assistant's title, or "Home" without one. */
  home: string;
  /** Strut's other apps, in launcher order. */
  apps: Array<{ title: string; href: string }>;
  admin: boolean;
  person: { name: string; tone: Tone; state: string };
}

/**
 * The left rail: wordmark, the home (the assistant), Apps, Organisation,
 * and the person with their run state. On phones it folds behind a menu
 * button and, when opened, sits above the page in the flow: it pushes
 * content down, never covers it.
 */
export function Rail({ orgName, home, apps, admin, person }: RailProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const is = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  // The admin Apps page and an app's versions; an app's own item is only its frame.
  const managingApps = path === "/apps" || /^\/apps\/[^/]+\/versions(\/|$)/.test(path);

  return (
    <>
      <div className="flex items-center justify-between border-b border-rule px-4 py-3 md:hidden">
        <Wordmark orgName={orgName} small />
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="rail"
          onClick={() => setOpen((o) => !o)}
          className="grid size-11 place-items-center rounded-[10px] border border-rule-strong bg-surface text-ink active:scale-[0.97]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            {open ? <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" /> : <path d="M3 5h12M3 9h12M3 13h12" />}
          </svg>
        </button>
      </div>

      <nav
        id="rail"
        aria-label="Main"
        className={`${open ? "flex" : "hidden"} flex-col gap-6 border-b border-rule px-5 py-6 md:sticky md:top-0 md:flex md:h-dvh md:w-[232px] md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 md:py-7`}
      >
        <div className="hidden px-3 md:block">
          <Wordmark orgName={orgName} />
        </div>

        <Item href="/" active={is("/")} strong>
          {home}
        </Item>

        {apps.length > 0 && (
          <Section label="Apps">
            {apps.map((a) => (
              <Item key={a.href} href={a.href} active={path === a.href}>
                {a.title}
              </Item>
            ))}
          </Section>
        )}

        {admin && (
          <Section label="Organisation">
            <Item href="/members" active={is("/members")}>
              Members
            </Item>
            <Item href="/status" active={is("/status")}>
              Status
            </Item>
            <Item href="/apps" active={managingApps}>
              Apps
            </Item>
            <Item href="/updates" active={is("/updates")}>
              Updates
            </Item>
            <Item href="/backups" active={is("/backups")}>
              Backups
            </Item>
          </Section>
        )}

        <div className="mt-auto flex flex-col gap-2 border-t border-rule pt-2">
          <Link
            href="/me"
            aria-current={is("/me") ? "page" : undefined}
            className={`flex flex-col gap-2 rounded-lg p-3 transition-colors duration-150 hover:bg-raised ${is("/me") ? "bg-raised" : ""}`}
          >
            <span className="truncate text-[14px] font-medium text-ink">{person.name}</span>
            <span className="text-[12px]">
              <Dot tone={person.tone} label={person.state} />
            </span>
          </Link>
          <div className="px-3 pb-1">
            <ThemeSegments />
          </div>
        </div>
      </nav>
    </>
  );
}

function Wordmark({ orgName, small }: { orgName: string; small?: boolean }) {
  return (
    <Link href="/" className="flex flex-col gap-0.5 text-ink">
      <span className="flex items-center gap-2">
        <LogoMark size={small ? 22 : 24} />
        <span className={`font-serif leading-none tracking-[-0.02em] ${small ? "text-[22px]" : "text-[24px]"}`}>stadeum</span>
      </span>
      <span className={`${small ? "text-[12px]" : "text-[13px]"} text-ink-3`}>{orgName}</span>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{label}</span>
      {children}
    </div>
  );
}

function Item({
  href,
  active,
  strong,
  children,
}: {
  href: string;
  active: boolean;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-lg px-3 text-[15px] transition-colors duration-150 ${strong ? "h-10" : "h-9"} ${
        active ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
