import { randomBytes } from "node:crypto";
import type { User } from "@prisma/client";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buildActor } from "@/lib/mothership/actor";
import { isRole, type Role } from "@/lib/roles";

/**
 * Who may sign in. Existing people always; otherwise, in order: the very
 * first person (becomes admin), an invited email (the invite's role), an
 * allowlisted domain (member). Everyone else is refused.
 */

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

export const emailDomain = (email: string) => email.split("@")[1] ?? "";

const newUserId = () => randomBytes(10).toString("hex");

export type AdmitResult = { user: User; created: boolean } | { user: null; reason: "not-invited" | "invalid-email" };

export async function admit(rawEmail: string, name?: string | null): Promise<AdmitResult> {
  const email = normaliseEmail(rawEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { user: null, reason: "invalid-email" };

  // One transaction: SQLite serialises writers, so two first sign-ins
  // cannot both see an empty table and both become admin.
  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), ...(name && !existing.name ? { name } : {}) },
      });
      return { user, created: false };
    }

    let role: Role | null = null;
    const invite = await tx.invite.findUnique({ where: { email } });
    if ((await tx.user.count()) === 0) role = "admin";
    else if (invite && !invite.acceptedAt) role = isRole(invite.role) ? invite.role : "member";
    else if (env.allowedDomains().includes(emailDomain(email))) role = "member";
    if (!role) return { user: null, reason: "not-invited" as const };

    const id = newUserId();
    const user = await tx.user.create({
      data: { id, email, name: name ?? null, role, actor: buildActor(email, id), lastSeenAt: new Date() },
    });
    if (invite) await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return { user, created: true };
  });
}
