import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signIn, signInOptions } from "@/auth";
import { env } from "@/lib/env";
import { safeNext, signInHref } from "@/lib/next-path";
import { currentUser } from "@/lib/session";
import { ThemeButton } from "@/components/theme-switch";
import { ArtCarousel } from "./art/carousel";
import { SignInChoices } from "./sign-in-choices";

export const metadata: Metadata = { title: "Sign in" };

const errors: Record<string, string> = {
  NotInvited: "That account hasn't been invited.",
  AccessDenied: "That account hasn't been invited.",
  NoEmail: "No verified email came back from the sign-in provider.",
  Configuration: "Sign-in isn't configured correctly.",
};

/** Where a sign-in lands: the page that sent the person here (each form's `next`), else home. */
const landing = (form: FormData) => safeNext(form.get("next")) ?? "/";

/** An unconfigured provider does nothing; the page just reloads. */
async function microsoft(form: FormData) {
  "use server";
  if (!signInOptions().microsoft) redirect(signInHref(form.get("next")));
  await signIn("microsoft-entra-id", { redirectTo: landing(form) });
}

async function google(form: FormData) {
  "use server";
  if (!signInOptions().google) redirect(signInHref(form.get("next")));
  await signIn("google", { redirectTo: landing(form) });
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

  return (
    <div className="signin-page flex min-h-dvh flex-col bg-paper text-ink md:flex-row">
      <ArtCarousel />

      <section className="relative flex flex-1 flex-col justify-start px-4 pt-10 pb-10 md:flex-[1_1_440px] md:justify-center md:px-[72px] md:py-12">
        <ThemeButton className="absolute top-3 right-3 md:top-5 md:right-5" />
        <div className="mx-auto flex w-full max-w-[360px] flex-col gap-4">
          <span className="text-[14px] text-ink-3">{env.orgName()}</span>
          <h2 className="mb-1 font-serif text-[30px] font-medium tracking-[-0.01em]">Sign in</h2>
          {error && (
            <p role="alert" className="rounded-[10px] bg-warn-soft px-4 py-3 text-[14px] text-ink">
              {errors[error] ?? "Sign-in didn't complete."}
            </p>
          )}
          <SignInChoices microsoft={microsoft} google={google} dev={dev} devAvailable={signInOptions().dev} next={next} />
        </div>
      </section>
    </div>
  );
}
