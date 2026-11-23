"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountMenu, type Person } from "./account-menu";
import { CallRailCard, useCall } from "./call";
import { LogoMark } from "./logo-mark";
import { SETTINGS, settingsPage, type SettingsItem } from "./settings-nav";

export interface RailProps {
  orgName: string;
  /** The top item, `/`: the assistant's title, or "Home" without one. */
  home: string;
  /** Strut's other apps in the rail, in launcher order: every one but those an admin unpinned (an admin-only one in an admin's rail alone). */
  apps: Array<{ title: string; href: string }>;
  admin: boolean;
  /** The apps an admin unpinned, among the organisation's pages: an admin's. */
  adminApps?: Array<{ title: string; href: string }>;
  person: Person;
}

/** The page an admin-unpinned app is, or the Settings page the path is on. */
function currentPage(
  path: string,
  adminPages: Array<{ href: string }>,
): string | undefined {
  if (adminPages.some((p) => p.href === path)) return path;
  return settingsPage(path);
}

/**
 * The left rail. Working, it holds the home (the assistant), Calls, the
 * apps and the person's menu; on a Settings page it holds Settings' own
 * pages and a way back. A call that is on shows at the bottom, on every
 * page but Calls (on phones, in the top bar), so it is in reach anywhere.
 * On phones the rail is a drawer behind a menu button: it slides in from
 * the left over the page, with a scrim that closes it, as do Escape and any
 * link in it. The page behind does not scroll meanwhile, and focus goes
 * into the drawer and back to the button. Closed, it is invisible, so
 * nothing in it takes a tab stop. From md up it is the column it always was.
 */
export function Rail({
  orgName,
  home,
  apps,
  admin,
  adminApps = [],
  person,
}: RailProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const button = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      close.current?.focus();
    } else if (wasOpen.current) {
      button.current?.focus();
    }
    wasOpen.current = open;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // The apps an admin unpinned sit among the organisation's pages, before Apps.
  const adminPages: SettingsItem[] = adminApps.map((a) => ({
    label: a.title,
    pages: [{ href: a.href, label: a.title }],
  }));
  const current = currentPage(
    path,
    adminPages.flatMap((i) => i.pages),
  );
  const call = useCall();
  const showCall = call.active && path !== "/calls";

  return (
    <>
      <div className="flex items-center justify-between border-b border-rule px-4 py-3 md:hidden">
        <Wordmark orgName={orgName} small />
        {showCall && (
          <span className="mr-2 ml-auto">
            <CallRailCard compact />
          </span>
        )}
        <button
          ref={button}
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
            {open ? (
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            ) : (
              <path d="M3 5h12M3 9h12M3 13h12" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <nav
        id="rail"
        aria-label={current ? "Settings" : "Main"}
        onClick={(e) => (e.target as Element).closest("a") && setOpen(false)}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(85vw,300px)] flex-col gap-6 overflow-y-auto border-r border-rule bg-paper px-5 py-6 transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        } md:visible md:sticky md:inset-auto md:top-0 md:z-auto md:w-[232px] md:shrink-0 md:translate-x-0 md:border-b-0 md:pt-7 md:pb-4 md:transition-none`}
      >
        <div className="flex items-start justify-between md:hidden">
          <Wordmark orgName={orgName} small />
          <button
            ref={close}
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="-mt-1 -mr-2 grid size-11 place-items-center rounded-[10px] text-ink-2 hover:bg-raised hover:text-ink"
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
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </button>
        </div>
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
            <SettingsSection
              label="You"
              items={SETTINGS.you}
              current={current}
            />
            {admin && (
              <SettingsSection
                label="Organisation"
                items={SETTINGS.organisation.flatMap((i) =>
                  i.label === "Apps" ? [...adminPages, i] : [i],
                )}
                current={current}
              />
            )}
            {showCall && (
              <div className="mt-auto hidden md:block">
                <CallRailCard />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hidden px-3 md:block">
              <Wordmark orgName={orgName} />
            </div>

            <div className="flex flex-col gap-0.5">
              <Item href="/" active={path === "/"} strong>
                {home}
              </Item>
              <Item href="/calls" active={path === "/calls"}>
                Calls
              </Item>
            </div>

            {apps.length > 0 && (
              <Section label="Apps">
                {apps.map((a) => (
                  <Item key={a.href} href={a.href} active={path === a.href}>
                    {a.title}
                  </Item>
                ))}
              </Section>
            )}

            <div className="mt-auto flex flex-col gap-2.5">
              {showCall && (
                <div className="hidden md:block">
                  <CallRailCard />
                </div>
              )}
              <div className="border-t border-rule pt-2.5">
                <AccountMenu person={person} admin={admin} />
              </div>
            </div>
          </>
        )}
      </nav>
    </>
  );
}

function SettingsSection({
  label,
  items,
  current,
}: {
  label: string;
  items: SettingsItem[];
  current: string;
}) {
  return (
    <Section label={label}>
      {items.map((i) => (
        <Item
          key={i.pages[0]!.href}
          href={i.pages[0]!.href}
          active={i.pages.some((p) => p.href === current)}
        >
          {i.label}
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
        <span
          className={`font-serif leading-none tracking-[-0.02em] ${small ? "text-[22px]" : "text-[24px]"}`}
        >
          stadeum
        </span>
      </span>
      <span className={`${small ? "text-[12px]" : "text-[13px]"} text-ink-3`}>
        {orgName}
      </span>
    </Link>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
        {label}
      </span>
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
        active
          ? "bg-raised font-medium text-ink"
          : "text-ink-2 hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
