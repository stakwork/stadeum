import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";

/** The signed-in person, fresh from the DB, or a redirect to /signin. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return db.user.findUnique({ where: { email } });
}

/** An admin; anyone else is sent home. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user.role)) redirect("/");
  return user;
}
