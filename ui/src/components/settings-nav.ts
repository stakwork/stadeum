export interface SettingsPage {
  href: string;
  label: string;
}

/** One rail item; more than one page shows a switcher under the page title. */
export interface SettingsItem {
  label: string;
  pages: SettingsPage[];
}

/** The pages that make up Settings: the person's own, then the organisation's (admins). */
export const SETTINGS: { you: SettingsItem[]; organisation: SettingsItem[] } = {
  you: [{ label: "Account", pages: [{ href: "/me", label: "Account" }] }],
  organisation: [
    { label: "Members", pages: [{ href: "/members", label: "Members" }] },
    {
      label: "Models",
      pages: [
        { href: "/models", label: "Models" },
        { href: "/spending", label: "Spending" },
      ],
    },
    {
      label: "Apps",
      pages: [
        { href: "/apps", label: "Apps" },
        { href: "/packages", label: "Packages" },
      ],
    },
    { label: "API keys", pages: [{ href: "/api-keys", label: "API keys" }] },
    { label: "Branding", pages: [{ href: "/branding", label: "Branding" }] },
    {
      label: "Server",
      pages: [
        { href: "/status", label: "Status" },
        { href: "/updates", label: "Updates" },
        { href: "/backups", label: "Backups" },
      ],
    },
  ],
};

const ITEMS = [...SETTINGS.you, ...SETTINGS.organisation];
const PATHS = ITEMS.flatMap((i) => i.pages.map((p) => p.href));

/**
 * The Settings page a path is on. The admin Apps page and an app's versions
 * are Settings; any other `/apps/<name>` is the app's frame.
 */
export function settingsPage(path: string): string | undefined {
  if (/^\/apps\/[^/]+\/versions(\/|$)/.test(path)) return "/apps";
  return PATHS.find((href) => path === href || (href !== "/apps" && path.startsWith(`${href}/`)));
}

/** The rail item holding a Settings page. */
export function settingsItem(href: string | undefined): SettingsItem | undefined {
  return href ? ITEMS.find((i) => i.pages.some((p) => p.href === href)) : undefined;
}
