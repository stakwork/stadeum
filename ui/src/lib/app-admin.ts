import { draftsOf, isHeld, isSeeded } from "@/lib/app-versions";
import { isOpened, launcherOrder } from "@/lib/apps";
import {
  getAppUsage,
  getAppVersions,
  listApps,
  type StrutApp,
  type StrutAppVersions,
  type StrutAppWarning,
} from "@/lib/strut/client";

/**
 * What the admin Apps page reads: strut's `GET /apps`, each app's
 * `GET /apps/:name/versions`, and for one app its `GET /apps/:name/usage`
 * (strut `specs/API.md` §14.5, §14.6). Server-side only, with the
 * deployment key; the pages check the role first.
 */

export interface ManagedApp {
  name: string;
  title: string;
  /** The live version. */
  active: string;
  /** The live release's id, or `latest` while every publish goes live. */
  live: string;
  held: boolean;
  drafts: number;
  pinned: boolean;
  /** The live version's usage warnings in the last day. */
  warnings: number;
  /** Strut makes its committed version live at every start: read-only here, but for an admin-only app's pin. */
  seeded: boolean;
  /** An admin's app alone (§14.14): pinned, it is in an admin's rail, else among the organisation's pages. */
  admin: boolean;
}

/**
 * Whether the admin may pin the app here. A seeded app is read-only, but
 * an admin-only one still takes a pin: it decides whether the app is in
 * an admin's rail, and pinning a seeded app holds nothing.
 */
export const canPin = (app: Pick<ManagedApp, "seeded" | "admin">) => !app.seeded || app.admin;

/** The admin page for one app's versions; `version` frames that one. */
export const versionsHref = (name: string, version?: string) =>
  `/apps/${encodeURIComponent(name)}/versions${version ? `/${encodeURIComponent(version)}` : ""}`;

function managed(app: StrutApp, v: StrutAppVersions): ManagedApp {
  return {
    name: app.name,
    title: app.title,
    active: v.active,
    live: v.live,
    held: isHeld(v.live),
    drafts: draftsOf(v),
    pinned: !!app.pinned,
    warnings: app.warnings ?? 0,
    seeded: isSeeded(v),
    admin: !!app.admin,
  };
}

/** Every app a person opens, in the launcher's order. Throws when strut does not answer. */
export async function managedApps(): Promise<ManagedApp[]> {
  const apps = launcherOrder(await listApps());
  const versions = await Promise.all(apps.map((a) => getAppVersions(a.name)));
  return apps.map((a, i) => managed(a, versions[i]!));
}

/** One app with its versions and the last day's warnings; null when strut lists no such app a person opens. */
export async function managedApp(
  name: string,
): Promise<{ app: ManagedApp; versions: StrutAppVersions; usage: StrutAppWarning[] } | null> {
  if (!isOpened(name)) return null;
  const app = (await listApps()).find((a) => a.name === name);
  if (!app) return null;
  const [versions, usage] = await Promise.all([getAppVersions(name), getAppUsage(name)]);
  return { app: managed(app, versions), versions, usage: usage.warnings };
}
