import type { Metadata } from "next";
import { revalidatePath } from "next/cache";

import { signOut } from "@/auth";
import { buttonClass } from "@/components/button";
import { describeDelegation } from "@/components/delegation";
import { PageHeader, SectionLabel } from "@/components/page-header";
import { Dot } from "@/components/state";
import { db } from "@/lib/db";
import { absoluteTime, longDate, relativeTime } from "@/lib/format";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { roleLabel, isRole } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "You" };
export const dynamic = "force-dynamic";

async function checkAgain() {
  "use server";
  const user = await requireUser();
  await ensureDelegation(user);
  revalidatePath("/me");
}

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

export default async function MePage() {
  const user = await requireUser();
  const m = await db.mothershipUser.findUnique({ where: { userId: user.id } });
  const access = describeDelegation(m);

  return (
    <>
      <PageHeader title={user.name || user.email} lede={user.name ? user.email : undefined}>
        <form action={signOutAction}>
          <button type="submit" className={buttonClass.secondary}>
            Sign out
          </button>
        </form>
      </PageHeader>

      <section aria-labelledby="access" className="flex max-w-3xl flex-col gap-3">
        <SectionLabel id="access">AI access</SectionLabel>
        <div className="rounded-[14px] border border-rule bg-surface p-5 shadow-soft md:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <span className="text-[13px]">
                <Dot tone={access.tone} label={access.label} />
              </span>
            </div>
            <form action={checkAgain}>
              <button type="submit" className={buttonClass.secondary}>
                Check again
              </button>
            </form>
          </div>

          <dl className="mt-7 grid grid-cols-1 gap-x-10 gap-y-1 border-t border-rule-soft pt-6 text-[14.5px] sm:grid-cols-[max-content_1fr] sm:gap-y-4">
            <Row label="Last checked">
              {m?.checkedAt ? (
                <time dateTime={m.checkedAt.toISOString()} title={absoluteTime(m.checkedAt)}>
                  {relativeTime(m.checkedAt)}
                </time>
              ) : (
                "Not yet"
              )}
            </Row>
            {m?.delegationExp && <Row label="Valid until">{longDate(m.delegationExp)}</Row>}
            <Row label="Billed as">
              <code className="font-mono text-[13px] text-ink-2 [overflow-wrap:anywhere]">{user.actor}</code>
            </Row>
            <Row label="Role">{isRole(user.role) ? roleLabel[user.role] : user.role}</Row>
            {m?.delegationError && !access.ready && (
              <Row label="Technical detail">
                <span className="text-ink-2 [overflow-wrap:anywhere]">{m.delegationError}</span>
              </Row>
            )}
          </dl>
        </div>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-2 text-[13px] text-ink-3 first:pt-0 sm:pt-0 sm:text-[14.5px]">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}
