import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PATH_HEADER, signInHref } from "@/lib/next-path";
import { isAdmin } from "@/lib/roles";

/** The signed-in person, fresh from the DB, or a redirect to /signin, which comes back to this page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(signInHref(await askedFor()));
  return user;
}

/** The page this request is for, as the middleware saw it; null outside a page's request (a test, an action). */
async function askedFor(): Promise<string | null> {
  try {
    return (await headers()).get(PATH_HEADER);
  } catch {
    return null;
  }
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
