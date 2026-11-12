import { cache } from "react";

import { isAdmin } from "@/lib/roles";
import { listApps as strutApps, type StrutApp } from "@/lib/strut/client";

/**
 * The apps a person opens: strut's `GET /apps`, never a list of our own
 * (AGENTS.md rule 2). Stadeum orders them and frames the one opened.
 */

export interface App {
  /** Strut's name; may contain `/` (`strut/jamie`). */
  name: string;
  title: string;
  description?: string;
  /** Stadeum's page for it: `/` for the assistant, else `/apps/<name, encoded>`. */
  href: string;
  /** The assistant, Jamie: the home. */
  assistant: boolean;
}

/**
 * Jamie, the person's assistant, which strut seeds on every server: the
 * home, ahead of every other app. A host opens it by this name (strut
 * `specs/API.md` §14.11). `strut/assistant` is its name on strut images
 * before 3e0f23b (stakwork/strut#528); later ones remove it at boot.
 */
const ASSISTANT = new Set(["strut/jamie", "strut/assistant"]);

/**
 * Listed by `GET /apps` but not a page a person opens: `strut/views` is the
 * component library other apps import (§14). The listing has no field that
 * tells a library from a page, so it is named here.
 */
const NOT_OPENED = new Set(["strut/views"]);

/** Whether a person opens the app at all. */
export const isOpened = (name: string) => !NOT_OPENED.has(name);

/**
 * Strut's Earnings (§14.14): the wallet and what paid runs earned, an
 * admin's alone. Stadeum frames it among the org's admin pages
 * (`/earnings`), never in the launcher. A strut without it (one older
 * than stakwork/strut#650, or seeded with `earnings: false`) lists none.
 */
export const EARNINGS = "strut/earnings";

const STRUT_APPS_TIMEOUT_MS = 5_000;

export const appHref = (name: string) => (ASSISTANT.has(name) ? "/" : `/apps/${encodeURIComponent(name)}`);

/** The assistant first, then the apps pinned as tabs, then the rest by title. */
export function launcherOrder<T extends Pick<StrutApp, "name" | "title" | "pinned">>(apps: T[]): T[] {
  const rank = (a: T) => (ASSISTANT.has(a.name) ? 0 : a.pinned ? 1 : 2);
  return apps
    .filter((a) => isOpened(a.name))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
}

/**
 * The launcher's apps: everyone's. Stadeum lists with its key, which strut
 * answers as full scope, so an admin-only app (`admin: true`, §14.14) is
 * in the listing and is left out here: the rail is every person's.
 */
export function launcherApps(apps: StrutApp[]): App[] {
  return launcherOrder(apps.filter((a) => !a.admin && a.name !== EARNINGS)).map((a) => ({
    name: a.name,
    title: a.title,
    ...(a.description ? { description: a.description } : {}),
    href: appHref(a.name),
    assistant: ASSISTANT.has(a.name),
  }));
}

/**
 * The launcher's apps, read once per request (the layout's rail and the
 * page share it). `null` when strut does not answer: every stadeum page
 * still renders without them.
 */
export const listApps = cache(async (): Promise<App[] | null> => {
  const apps = await strutListing();
  return apps && launcherApps(apps);
});

/** Strut's Earnings for a person with `role`: only an admin's, and only when strut lists it. */
export function earningsFor(role: string, apps: StrutApp[] | null): Pick<App, "name" | "title"> | null {
  const app = isAdmin(role) ? apps?.find((a) => a.name === EARNINGS) : undefined;
  return app ? { name: app.name, title: app.title } : null;
}

/** `earningsFor` on this request's listing. */
export const earningsApp = async (role: string) => earningsFor(role, isAdmin(role) ? await strutListing() : null);

/** `GET /apps`, once per request; `null` when strut does not answer. */
const strutListing = cache(async (): Promise<StrutApp[] | null> => {
  try {
    return await strutApps(STRUT_APPS_TIMEOUT_MS);
  } catch (err) {
    console.warn(`[apps] GET /apps failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
});
