import type { User } from "@prisma/client";

import { db } from "@/lib/db";
import type { Role } from "@/lib/roles";

/**
 * Role changes and removals, with the guards: nobody changes their own
 * role or removes themselves, and the last admin can be neither demoted
 * nor removed. Each runs in one transaction, so two admins acting at once
 * cannot leave the org without one.
 */

export type MemberChange = { ok: true } | { ok: false; reason: "self" | "not-found" | "last-admin" };

export async function setRole(me: Pick<User, "id">, id: string, role: Role): Promise<MemberChange> {
  if (id === me.id) return { ok: false, reason: "self" };
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) return { ok: false, reason: "not-found" } as const;
    if (target.role === "admin" && role !== "admin" && (await tx.user.count({ where: { role: "admin" } })) <= 1) {
      return { ok: false, reason: "last-admin" } as const;
    }
    await tx.user.update({ where: { id }, data: { role } });
    return { ok: true } as const;
  });
}

/** Removes the person and any invite for their email; returns them so the caller can clean up elsewhere. */
export async function removeUser(me: Pick<User, "id">, id: string): Promise<MemberChange & { user?: User }> {
  if (id === me.id) return { ok: false, reason: "self" };
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) return { ok: false, reason: "not-found" } as const;
    if (target.role === "admin" && (await tx.user.count({ where: { role: "admin" } })) <= 1) {
      return { ok: false, reason: "last-admin" } as const;
    }
    await tx.invite.deleteMany({ where: { email: target.email } });
    await tx.user.delete({ where: { id } });
    return { ok: true, user: target } as const;
  });
}
