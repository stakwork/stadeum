"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountMenu, type Person } from "./account-menu";
import { LogoMark } from "./logo-mark";

export interface RailProps {
  orgName: string;
  /** The top item, `/`: the assistant's title, or "Home" without one. */
  home: string;
  /** Strut's other apps, in launcher order. */
  apps: Array<{ title: string; href: string }>;
  admin: boolean;
  person: Person;
}

/** The pages that make up Settings: the person's own, then the organisation's (admins). */
const SETTINGS = {
  you: [{ href: "/me", label: "Account" }],
  organisation: [
    { href: "/members", label: "Members" },
    { href: "/models", label: "Models" },
    { href: "/apps", label: "Apps" },
    { href: "/branding", label: "Branding" },
  ],
  server: [
    { href: "/status", label: "Status" },
    { href: "/updates", label: "Updates" },
    { href: "/backups", label: "Backups" },
  ],
};

const SETTINGS_PATHS = [...SETTINGS.you, ...SETTINGS.organisation, ...SETTINGS.server].map((p) => p.href);

/** The admin Apps page and an app's versions are Settings; `/apps/<name>` alone is the app's frame. */
function settingsPage(path: string): string | undefined {
  if (/^\/apps\/[^/]+\/versions(\/|$)/.test(path)) return "/apps";
  return SETTINGS_PATHS.find((href) => path === href || (href !== "/apps" && path.startsWith(`${href}/`)));
}

/**
 * The left rail. Working, it holds the home (the assistant), the apps and
 * the person's menu; on a Settings page it holds Settings' own pages and a
 * way back. On phones it folds behind a menu button and, when opened, sits
 * above the page in the flow: it pushes content down, never covers it.
 */
export function Rail({ orgName, home, apps, admin, person }: RailProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const current = settingsPage(path);

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
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            {open ? <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" /> : <path d="M3 5h12M3 9h12M3 13h12" />}
          </svg>
        </button>
      </div>

      <nav
        id="rail"
        aria-label={current ? "Settings" : "Main"}
        className={`${open ? "flex" : "hidden"} flex-col gap-6 border-b border-rule px-5 py-6 md:sticky md:top-0 md:flex md:h-dvh md:w-[232px] md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 md:pt-7 md:pb-4`}
      >
        {current ? (
          <>
            <Link
              href="/"
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-[14px] text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M10 3.5L5.5 8l4.5 4.5" />
              </svg>
              Back to {orgName}
            </Link>
            <SettingsSection label="You" pages={SETTINGS.you} current={current} />
            {admin && <SettingsSection label="Organisation" pages={SETTINGS.organisation} current={current} />}
            {admin && <SettingsSection label="This server" pages={SETTINGS.server} current={current} />}
          </>
        ) : (
          <>
            <div className="hidden px-3 md:block">
              <Wordmark orgName={orgName} />
            </div>

            <Item href="/" active={path === "/"} strong>
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

            <div className="mt-auto border-t border-rule pt-2.5">
              <AccountMenu person={person} admin={admin} />
            </div>
          </>
        )}
      </nav>
    </>
  );
}

function SettingsSection({
  label,
  pages,
  current,
}: {
  label: string;
  pages: Array<{ href: string; label: string }>;
  current: string;
}) {
  return (
    <Section label={label}>
      {pages.map((p) => (
        <Item key={p.href} href={p.href} active={current === p.href}>
          {p.label}
        </Item>
      ))}
    </Section>
  );
}

function Wordmark({ orgName, small }: { orgName: string; small?: boolean }) {
  return (
    <Link href="/" className="flex flex-col gap-0.5 text-ink">
      <span className="flex items-center gap-2">
        <LogoMark size={small ? 22 : 24} />
        <span className={`font-serif leading-none tracking-[-0.02em] ${small ? "text-[22px]" : "text-[24px]"}`}>
          stadeum
        </span>
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
