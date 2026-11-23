import { cache } from "react";

import { db } from "@/lib/db";

/**
 * Which apps are in the rail: every app strut lists but the ones an admin
 * unpinned (`Org.unpinnedApps`), so a new app is pinned. Stadeum's alone:
 * it moves nothing in strut, whose own pin holds a version (§14).
 */
export const unpinnedApps = cache(async (): Promise<ReadonlySet<string>> => {
  const org = await db.org.findUnique({ where: { id: "org" }, select: { unpinnedApps: true } });
  return new Set(parse(org?.unpinnedApps));
});

/** Pin the app to the rail, or take it out. */
export async function setAppPinned(name: string, pinned: boolean): Promise<void> {
  await db.$transaction(async (tx) => {
    const org = await tx.org.findUnique({ where: { id: "org" }, select: { unpinnedApps: true } });
    const names = new Set(parse(org?.unpinnedApps));
    if (pinned) names.delete(name);
    else names.add(name);
    const data = { unpinnedApps: names.size ? JSON.stringify([...names].sort()) : null };
    await tx.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data });
  });
}

function parse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
