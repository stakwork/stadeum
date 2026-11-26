"use server";

import { revalidatePath } from "next/cache";

import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireAdmin } from "@/lib/session";

export type CreateState = { error?: string; created?: { name: string; key: string } };

export async function create(_prev: CreateState, form: FormData): Promise<CreateState> {
  const me = await requireAdmin();
  const made = await createApiKey(me, { name: String(form.get("name") ?? ""), scope: String(form.get("scope") ?? "") });
  if (!made.ok) return { error: made.reason === "invalid-scope" ? "Choose a scope." : "Give the key a name of up to 60 characters." };
  revalidatePath("/api-keys");
  return { created: { name: made.record.name, key: made.key } };
}

export async function revoke(form: FormData) {
  await requireAdmin();
  await revokeApiKey(String(form.get("id")));
  revalidatePath("/api-keys");
}
