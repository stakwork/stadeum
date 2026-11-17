import { cookies } from "next/headers";

import { admit } from "@/lib/access";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { maskEmail, REJECTED_COOKIE } from "@/lib/signin-message";

export { maskEmail };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Remember the masked email (only) for the sign-in page, briefly. Never fails the sign-in. */
async function rememberRejected(masked: string) {
  try {
    (await cookies()).set(REJECTED_COOKIE, masked, {
      maxAge: 600,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  } catch (err) {
    console.warn(`[signin] could not keep the rejected email for the page: ${errMsg(err)}`);
  }
}

/**
 * Auth.js's signIn decision: true to let the person in (their email
 * normalised on `user`), else the sign-in page's redirect.
 */
export async function checkSignIn(
  user: { email?: string | null; name?: string | null },
  email: string | null,
  provider: string | undefined,
): Promise<true | string> {
  if (!email) {
    console.warn(`[signin] rejected provider=${provider ?? "unknown"} reason=no-email`);
    return "/signin?error=NoEmail";
  }
  const masked = maskEmail(email);
  let admitted;
  try {
    admitted = await admit(email, user.name);
  } catch (err) {
    console.error(`[signin] check failed provider=${provider ?? "unknown"} email=${masked}: ${errMsg(err)}`);
    return "/signin?error=SignInFailed";
  }
  if (!admitted.user) {
    console.warn(`[signin] rejected provider=${provider ?? "unknown"} reason=${admitted.reason} email=${masked}`);
    await rememberRejected(masked);
    return "/signin?error=NotInvited";
  }
  user.email = admitted.user.email;
  // Never blocks or fails the sign-in; the person's page shows the outcome.
  void ensureDelegation(admitted.user).catch((err) =>
    console.warn(`[signin] delegation for ${masked} failed: ${errMsg(err)}`),
  );
  return true;
}
