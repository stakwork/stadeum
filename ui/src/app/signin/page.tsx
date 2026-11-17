import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn, signInOptions } from "@/auth";
import { env } from "@/lib/env";
import { safeNext, signInHref } from "@/lib/next-path";
import { labelState } from "@/lib/signin-bounce";
import { REJECTED_COOKIE, signInMessage } from "@/lib/signin-message";
import { currentUser } from "@/lib/session";
import { buttonClass } from "@/components/button";
import { ThemeButton } from "@/components/theme-switch";
import { ArtCarousel } from "./art/carousel";
import { SignInChoices } from "./sign-in-choices";

export const metadata: Metadata = { title: "Sign in" };

/** Where a sign-in lands: the page that sent the person here (each form's `next`), else home. */
const landing = (form: FormData) => safeNext(form.get("next")) ?? "/";

/**
 * An unconfigured provider does nothing; the page just reloads. A
 * configured one goes to the provider, with this box's label on the state
 * when it signs in through a bounce (lib/signin-bounce.ts).
 */
async function microsoft(form: FormData) {
  "use server";
  if (!signInOptions().microsoft) redirect(signInHref(form.get("next")));
  redirect(labelState(await signIn("microsoft-entra-id", { redirectTo: landing(form), redirect: false })));
}

async function google(form: FormData) {
  "use server";
  if (!signInOptions().google) redirect(signInHref(form.get("next")));
  redirect(labelState(await signIn("google", { redirectTo: landing(form), redirect: false })));
}

/** Clears what could keep a refused person stuck, then asks Google again, with its account picker. */
async function otherAccount(form: FormData) {
  "use server";
  if (!signInOptions().google) redirect(signInHref(form.get("next")));
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (name === REJECTED_COOKIE || /^(__Secure-|__Host-)?authjs\./.test(name)) jar.delete(name);
  }
  redirect(
    labelState(await signIn("google", { redirectTo: landing(form), redirect: false }, { prompt: "select_account" })),
  );
}

async function dev(form: FormData) {
  "use server";
  if (!signInOptions().dev) redirect(signInHref(form.get("next")));
  await signIn("dev", { email: String(form.get("email") ?? ""), redirectTo: landing(form) });
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: asked } = await searchParams;
  const next = safeNext(asked) ?? undefined;
  if (await currentUser()) redirect(next ?? "/");
  const message = error
    ? signInMessage(error, error === "NotInvited" || error === "AccessDenied" ? (await cookies()).get(REJECTED_COOKIE)?.value : undefined, { canSwitch: signInOptions().google })
    : null;

  return (
    <div className="signin-page flex min-h-dvh flex-col bg-paper text-ink md:flex-row">
      <ArtCarousel />

      <section className="relative flex flex-1 flex-col justify-start px-4 pt-10 pb-10 md:flex-[1_1_440px] md:justify-center md:px-[72px] md:py-12">
        <ThemeButton className="absolute top-3 right-3 md:top-5 md:right-5" />
        <div className="mx-auto flex w-full max-w-[360px] flex-col gap-4">
          <span className="text-[14px] text-ink-3">{env.orgName()}</span>
          <h2 className="mb-1 font-serif text-[30px] font-medium tracking-[-0.01em]">Sign in</h2>
          {message && (
            <div role="alert" className="flex flex-col gap-1 rounded-[10px] bg-warn-soft px-4 py-3 text-[14px] text-ink">
              <p>{message.title}</p>
              {message.detail && <p className="text-ink-2">{message.detail}</p>}
            </div>
          )}
          {message?.notInvited && signInOptions().google && (
            <form action={otherAccount}>
              {next && <input type="hidden" name="next" value={next} />}
              <button type="submit" className={`${buttonClass.secondary} h-12 w-full`}>
                Use a different account
              </button>
            </form>
          )}
          {message && (
            <Link href={signInHref(next)} className="text-[13px] text-ink-3 underline hover:text-ink-2">
              Back to sign in
            </Link>
          )}
          <SignInChoices microsoft={microsoft} google={google} dev={dev} devAvailable={signInOptions().dev} next={next} />
        </div>
      </section>
    </div>
  );
}
