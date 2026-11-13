"use server";

import { isAdminOnly } from "@/lib/apps";
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
 * strut refuses a member's session anyway).
 */
export async function openApp(app: string, input?: string): Promise<{ src: string } | { error: true }> {
  const user = await requireUser();
  if (!isAppKey(app)) return { error: true };
  if (!isAdmin(user.role) && (/@v\d+$/.test(app) || (await isAdminOnly(app)))) return { error: true };
  // Renews past half-life, as Hive does on every embed. Never throws.
  await ensureDelegation(user);
  try {
    return { src: await embedUrl(user.actor, user.role, app, typeof input === "string" && input ? input.slice(0, 2000) : undefined) };
  } catch (err) {
    console.warn(`[apps] no frame for ${app}: ${err instanceof Error ? err.message : String(err)}`);
    return { error: true };
  }
}
