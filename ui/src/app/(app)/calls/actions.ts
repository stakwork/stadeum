"use server";

import { isAppKey, isServedPath } from "@/lib/call-transcript";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { embedArtifactUrl, embedUrl } from "@/lib/strut/client";

/**
 * Something the assistant handed over in a call, opened through strut:
 * strut's viewer for one of its files, or an app, framed and signed in as
 * the person (a one-use ticket). Stadeum draws neither (AGENTS.md rule 2).
 * The target came from the call's agent, so it is checked again here.
 */
export async function openInStrut(target: { artifact?: unknown; app?: unknown }): Promise<{ src: string; origin: string } | { error: string }> {
  const user = await requireUser();
  const origin = new URL(env.strutPublicUrl()).origin;
  try {
    if (isServedPath(target.artifact)) return { src: await embedArtifactUrl(user.actor, user.role, target.artifact), origin };
    if (isAppKey(target.app)) return { src: await embedUrl(user.actor, user.role, target.app), origin };
  } catch (err) {
    console.warn(`[calls] could not open an artifact for ${user.actor}: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Strut isn’t answering, so this can’t open right now." };
  }
  return { error: "This can’t be opened here." };
}
