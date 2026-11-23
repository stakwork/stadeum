/** Pure pieces of the sign-in refusal: the masked email and the page's message. */

/** "alice@example.com" -> "a***e@example.com"; a short local part shows only its first letter. Domain kept. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return local.length <= 2 ? `${local[0]}***${domain}` : `${local[0]}***${local[local.length - 1]}${domain}`;
}

/** Only a masked address (as `maskEmail` makes) is shown; anything else read from a cookie is dropped. */
export function validMasked(value: string | undefined | null): string | undefined {
  return value && /^[^@\s*]\*\*\*[^@\s*]?@[^@\s]{1,253}$/.test(value) ? value : undefined;
}

export const REJECTED_COOKIE = "stadeum.signin.rejected";

const generic: Record<string, string> = {
  NoEmail: "No verified email came back from the sign-in provider.",
  Configuration: "Sign-in isn't configured correctly.",
  SignInFailed: "Something went wrong checking your access. Try again in a moment.",
};

export type SignInMessage = { title: string; detail?: string; notInvited: boolean };

/** What the page says for an `?error=` code; `maskedEmail` only counts for a not-invited refusal. */
export function signInMessage(
  error: string,
  maskedEmail?: string | null,
  { canSwitch = true }: { canSwitch?: boolean } = {},
): SignInMessage {
  if (error === "NotInvited" || error === "AccessDenied") {
    const who = validMasked(maskedEmail);
    return {
      title: who ? `${who} hasn't been invited.` : "That account hasn't been invited.",
      detail: `An admin must invite that exact email address on the Members page. ${
        canSwitch
          ? "If you meant a different Google account, use the button below."
          : "If you meant a different account, sign in with it below."
      }`,
      notInvited: true,
    };
  }
  return { title: generic[error] ?? "Sign-in didn't complete.", notInvited: false };
}
