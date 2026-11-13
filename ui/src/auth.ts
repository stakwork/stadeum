import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { admit } from "@/lib/access";
import { env } from "@/lib/env";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { bounceOptions } from "@/lib/signin-bounce";

/**
 * Sign-in: Microsoft Entra ID and Google when configured, plus an
 * email-only login when STADEUM_DEV_LOGIN=1. JWT sessions; the session
 * carries only the email, and role/membership are read fresh from the DB
 * on every request (lib/session.ts), so a removal takes effect at once.
 */

function providers(): Provider[] {
  const list: Provider[] = [];
  const entra = env.entra();
  if (entra) list.push(MicrosoftEntraID({ ...entra, ...bounceOptions() }));
  const google = env.google();
  if (google) list.push(Google({ ...google, ...bounceOptions() }));
  if (env.devLogin()) {
    list.push(
      Credentials({
        id: "dev",
        name: "Development",
        credentials: { email: { label: "Email", type: "email" } },
        authorize: (creds) => {
          const email = typeof creds?.email === "string" ? creds.email.trim() : "";
          return email ? { id: email, email, name: email.split("@")[0] } : null;
        },
      }),
    );
  }
  return list;
}

/** The provider's verified email. Entra may only give `preferred_username`. */
function emailFrom(
  user: { email?: string | null },
  profile: Record<string, unknown> | undefined,
  provider: string | undefined,
): string | null {
  if (provider === "google" && profile && profile.email_verified !== true) return null;
  const candidates = [user.email, profile?.email, profile?.preferred_username, profile?.upn];
  const email = candidates.find((c): c is string => typeof c === "string" && c.includes("@"));
  return email ?? null;
}

export const authConfig: NextAuthConfig = {
  providers: providers(),
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  trustHost: true,
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = emailFrom(user, profile as Record<string, unknown> | undefined, account?.provider);
      if (!email) return "/signin?error=NoEmail";
      const admitted = await admit(email, user.name);
      if (!admitted.user) return "/signin?error=NotInvited";
      user.email = admitted.user.email;
      // Never blocks or fails the sign-in; the person's page shows the outcome.
      void ensureDelegation(admitted.user).catch(() => undefined);
      return true;
    },
    jwt({ token, user }) {
      if (user?.email) token.email = user.email.toLowerCase();
      return token;
    },
    session({ session, token }) {
      if (typeof token.email === "string") session.user.email = token.email;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** What the sign-in page offers, read from the same env as `providers()`. */
export const signInOptions = () => ({
  microsoft: !!env.entra(),
  google: !!env.google(),
  dev: env.devLogin(),
});
