"use server";

import { revalidatePath } from "next/cache";

import { normaliseEmail } from "@/lib/access";
import { db } from "@/lib/db";
import { removeUser, setRole } from "@/lib/members";
import { isRole } from "@/lib/roles";
import { requireAdmin } from "@/lib/session";
import { deleteDelegation } from "@/lib/strut/client";

export type FormState = { ok?: string; error?: string };

export async function invite(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const email = normaliseEmail(String(form.get("email") ?? ""));
  const role = form.get("role");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That doesn't look like an email address." };
  if (!isRole(role)) return { error: "Choose Admin or Member." };
  if (await db.user.findUnique({ where: { email } })) return { error: `${email} is already a member.` };
  await db.invite.upsert({
    where: { email },
    create: { email, role, invitedById: me.id },
    update: { role, invitedById: me.id, acceptedAt: null, createdAt: new Date() },
  });
  revalidatePath("/members");
  return { ok: `Invited ${email}.` };
}

export async function revokeInvite(form: FormData) {
  await requireAdmin();
  await db.invite.deleteMany({ where: { id: String(form.get("id")), acceptedAt: null } });
  revalidatePath("/members");
}

export async function changeRole(form: FormData) {
  const me = await requireAdmin();
  const id = String(form.get("id"));
  const role = form.get("role");
  if (!isRole(role)) return;
  await setRole(me, id, role);
  revalidatePath("/members");
}

export async function removeMember(form: FormData) {
  const me = await requireAdmin();
  const id = String(form.get("id"));
  const removed = await removeUser(me, id);
  if (!removed.user) return;
  const target = removed.user;
  // Strut should stop billing to someone who has left. Best-effort: the
  // person can no longer sign in either way.
  await deleteDelegation(target.actor).catch((err) =>
    console.warn(`[members] could not remove Strut delegation for ${target.actor}: ${err instanceof Error ? err.message : String(err)}`),
  );
  revalidatePath("/members");
}
