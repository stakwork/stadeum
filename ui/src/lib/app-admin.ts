import { draftsOf, isHeld, isSeeded } from "@/lib/app-versions";
import { unpinnedApps } from "@/lib/app-pins";
import { isAssistant, isOpened, launcherOrder } from "@/lib/apps";
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
  /** In the rail (`./app-pins.ts`): stadeum's, not strut's pin. */
  pinned: boolean;
  /** The live version's usage warnings in the last day. */
  warnings: number;
  /** Strut makes its committed version live at every start: read-only here, but for the pin. */
  seeded: boolean;
  /** An admin's app alone (§14.14): pinned, it is in an admin's rail alone. */
  admin: boolean;
}

/** Whether the admin may pin the app to the rail: any app but the assistant, which is the home. */
export const canPin = (app: Pick<ManagedApp, "name">) => !isAssistant(app.name);

/** Whether the admin may delete the app: not the assistant, nor one strut seeds (it returns at every start). */
export const canDelete = (app: Pick<ManagedApp, "name" | "seeded">) => !isAssistant(app.name) && !app.seeded;

/** The admin page for one app's versions; `version` frames that one. */
export const versionsHref = (name: string, version?: string) =>
  `/apps/${encodeURIComponent(name)}/versions${version ? `/${encodeURIComponent(version)}` : ""}`;

function managed(app: StrutApp, v: StrutAppVersions, unpinned: ReadonlySet<string>): ManagedApp {
  return {
    name: app.name,
    title: app.title,
    active: v.active,
    live: v.live,
    held: isHeld(v.live),
    drafts: draftsOf(v),
    pinned: !unpinned.has(app.name),
    warnings: app.warnings ?? 0,
    seeded: isSeeded(v),
    admin: !!app.admin,
  };
}

/** Every app a person opens, in the launcher's order. Throws when strut does not answer. */
export async function managedApps(): Promise<ManagedApp[]> {
  const apps = launcherOrder(await listApps());
  const [versions, unpinned] = await Promise.all([Promise.all(apps.map((a) => getAppVersions(a.name))), unpinnedApps()]);
  return apps.map((a, i) => managed(a, versions[i]!, unpinned));
}

/** One app with its versions and the last day's warnings; null when strut lists no such app a person opens. */
export async function managedApp(
  name: string,
): Promise<{ app: ManagedApp; versions: StrutAppVersions; usage: StrutAppWarning[] } | null> {
  if (!isOpened(name)) return null;
  const app = (await listApps()).find((a) => a.name === name);
  if (!app) return null;
  const [versions, usage, unpinned] = await Promise.all([getAppVersions(name), getAppUsage(name), unpinnedApps()]);
  return { app: managed(app, versions, unpinned), versions, usage: usage.warnings };
}
