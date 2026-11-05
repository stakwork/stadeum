"use server";

import { revalidatePath } from "next/cache";

import { readStatus, request, saveUpdates } from "@/lib/ops/store";
import { requireAdmin } from "@/lib/session";

export type FormState = { ok?: string; error?: string };

export async function saveSchedule(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const saved = await saveUpdates({
    start: String(form.get("start") ?? ""),
    end: String(form.get("end") ?? ""),
    timeZone: String(form.get("timeZone") ?? ""),
    drainMinutes: Number(form.get("drainMinutes")),
    enabled: form.get("enabled") === "on",
  });
  if (!saved.ok) return { error: saved.error };
  revalidatePath("/updates");
  revalidatePath("/backups");
  return { ok: "Saved." };
}

export async function checkNow() {
  await requireAdmin();
  await request("check");
  revalidatePath("/updates");
}

export async function updateNow() {
  await requireAdmin();
  await request("update");
  revalidatePath("/updates");
}

/**
 * "Upgrade Neo4j": let the held release in. The target is what the page
 * showed; ops moves only to it, after a fresh backup, so a release that
 * moved on since is held again.
 */
export async function confirmRelease(form: FormData) {
  await requireAdmin();
  const target = String(form.get("target") ?? "");
  const held = (await readStatus())?.status.release?.held ?? [];
  if (!held.length || held.map((h) => h.to).join(",") !== target) return;
  await request("confirm", target);
  revalidatePath("/updates");
}
