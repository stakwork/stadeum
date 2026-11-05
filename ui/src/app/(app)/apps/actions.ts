"use server";

import { revalidatePath } from "next/cache";

import { isOpened } from "@/lib/apps";
import { requireAdmin } from "@/lib/session";
import { setAppLive, setAppPinned, StrutHttpError, type LiveTarget } from "@/lib/strut/client";

/** A refusal in strut's own words; `instead`: the version a refused Restore can make live as it is now. */
export type ChangeResult = { error?: string; instead?: string };

const VERSION_RE = /^(v\d+|latest)$/;
const RELEASE_RE = /^r\d+$/;

function refusal(err: unknown): string {
  if (err instanceof StrutHttpError) return err.detail ?? `Strut answered ${err.status}.`;
  return "Strut isn’t answering. Nothing changed.";
}

/** What people open: `PUT /apps/:name/active`, as this admin. */
export async function makeLive(name: string, target: LiveTarget, instead?: string): Promise<ChangeResult> {
  const me = await requireAdmin();
  const valid = "release" in target ? RELEASE_RE.test(target.release) : VERSION_RE.test(target.version);
  if (!isOpened(name) || !valid) return { error: "That is not a change stadeum makes." };
  try {
    await setAppLive(name, "release" in target ? { release: target.release } : { version: target.version }, me.actor);
  } catch (err) {
    return { error: refusal(err), ...(instead && "release" in target && VERSION_RE.test(instead) ? { instead } : {}) };
  }
  // Every page: the rail lists the apps too.
  revalidatePath("/", "layout");
  return {};
}

/** Pin or unpin: `PUT /apps/:name/pin`, as this admin. */
export async function pin(name: string, pinned: boolean): Promise<ChangeResult> {
  const me = await requireAdmin();
  if (!isOpened(name) || typeof pinned !== "boolean") return { error: "That is not a change stadeum makes." };
  try {
    await setAppPinned(name, pinned, me.actor);
  } catch (err) {
    return { error: refusal(err) };
  }
  revalidatePath("/", "layout");
  return {};
}
