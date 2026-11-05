"use server";

import { revalidatePath } from "next/cache";

import { DESTINATIONS, isKind } from "@/lib/ops/destination";
import { markPasswordKept, request, saveDestination } from "@/lib/ops/store";
import { requireAdmin } from "@/lib/session";

export type FormState = { ok?: string; error?: string };

export async function saveBackups(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const kind = form.get("kind");
  const values: Record<string, string> = {};
  if (isKind(kind)) for (const f of DESTINATIONS[kind].fields) values[f.name] = String(form.get(f.name) ?? "");
  const saved = await saveDestination(kind, values, form.get("enabled") === "on");
  if (!saved.ok) return { error: saved.error };
  revalidatePath("/backups");
  return { ok: "Saved. ops uses it from its next backup." };
}

export async function backUpNow() {
  await requireAdmin();
  await request("backup");
  revalidatePath("/backups");
}

export async function passwordKept() {
  await requireAdmin();
  await markPasswordKept();
  revalidatePath("/backups");
}
