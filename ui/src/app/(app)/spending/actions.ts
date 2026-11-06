"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/session";
import { changeDefaults, changePersonLimit, type Change } from "@/lib/spend/limits";
import { isReset, parseLimit } from "@/lib/spend/rules";

export type Result = { error?: string; ok?: string };

/** What a save says. The gateway may not have taken it yet; the next upkeep pass retries. */
function said(change: Change): Result {
  if (change.unchanged) return { ok: "Nothing changed." };
  if (change.failed) {
    const what = change.failed === 1 ? "one limit" : `${change.failed} limits`;
    return { error: `Saved, but the gateway didn’t take ${what} yet. It’s retried within six hours.` };
  }
  return { ok: "Saved." };
}

/** Everyone's limit and how often it resets. */
export async function saveDefaults(_prev: Result, form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const limit = parseLimit(String(form.get("limit") ?? ""));
  if (typeof limit !== "number") return limit;
  const reset = String(form.get("reset") ?? "");
  if (!isReset(reset)) return { error: "Pick how often limits reset." };
  const result = said(await changeDefaults(admin, { limitUsd: limit, reset }));
  revalidatePath("/spending");
  return result;
}

/** One person's own limit, or back to everyone's when `limit` is empty. */
export async function setPersonLimit(userId: string, _prev: Result, form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const raw = String(form.get("limit") ?? "").trim();
  let own: number | null = null;
  if (raw) {
    const limit = parseLimit(raw);
    if (typeof limit !== "number") return limit;
    own = limit;
  }
  try {
    const result = said(await changePersonLimit(admin, userId, own));
    revalidatePath("/spending");
    return result;
  } catch {
    return { error: "That person isn’t a member any more." };
  }
}
