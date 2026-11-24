"use server";

import { adminApps, appHref, isAdminOnly, listApps } from "@/lib/apps";
import { isAppKey } from "@/lib/call-transcript";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { embedUrl } from "@/lib/strut/client";

/**
 * Where a framed app loads, for this person, now: strut's page with a
 * fresh one-use ticket (`embedUrl`). The frame asks each time it opens,
 * never the server's render: Next shows a page it already has again (on
 * Back, after a redirect) without rendering it, and a ticket in that page
 * would be spent. One version of an app (`<name>@vN`) is an admin's alone,
 * and so is an app strut lists as admin-only (`admin: true`, §14.14, which
 * strut refuses a member's session anyway). Strut is told the app's page
 * here (`appHref`), which its links to paste are built on; a version has
 * no page of its own to send.
 */
export async function openApp(app: string, input?: string): Promise<{ src: string } | { error: true }> {
  const user = await requireUser();
  if (!isAppKey(app)) return { error: true };
  const version = /@v\d+$/.test(app);
  if (!isAdmin(user.role) && (version || (await isAdminOnly(app)))) return { error: true };
  // Renews past half-life, as Hive does on every embed. Never throws.
  await ensureDelegation(user);
  try {
    return { src: await embedUrl(user, app, typeof input === "string" && input ? input.slice(0, 2000) : undefined, version ? undefined : appHref(app)) };
  } catch (err) {
    console.warn(`[apps] no frame for ${app}: ${err instanceof Error ? err.message : String(err)}`);
    return { error: true };
  }
}

/**
 * Stadeum's page for an app a framed one opens as the page (`strut:open`),
 * at `input`: the app's `href` among the apps this person opens (`/` for
 * the assistant, `/apps/<name>`, Earnings' own), with `?input=`. `null`
 * for one that is not theirs (an admin's app to a member, a peer's, one
 * strut does not list): the frame stays where it is.
 */
export async function appPage(app: string, input?: string): Promise<string | null> {
  const user = await requireUser();
  const apps = [...((await listApps()) ?? []), ...(await adminApps(user.role))];
  const href = apps.find((a) => a.name === app)?.href;
  if (!href) return null;
  return typeof input === "string" && input ? `${href}?${new URLSearchParams({ input: input.slice(0, 2000) })}` : href;
}
