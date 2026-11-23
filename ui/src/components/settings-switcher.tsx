"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { settingsItem, settingsPage } from "./settings-nav";

/** On a Settings page whose rail item holds several, the pages side by side. Nothing elsewhere. */
export function SettingsSwitcher() {
  // Null outside the app router, as in a rendered test.
  const current = settingsPage(usePathname() ?? "");
  const item = settingsItem(current);
  if (!item || item.pages.length < 2) return null;
  return (
    <nav aria-label={item.label} className="flex gap-5 border-b border-rule">
      {item.pages.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={p.href === current ? "page" : undefined}
          className={`-mb-px border-b-2 pb-2.5 text-[14px] transition-colors duration-150 ${
            p.href === current ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
