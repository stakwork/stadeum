import type { Metadata } from "next";
import { revalidatePath } from "next/cache";

import { buttonClass } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Dot } from "@/components/state";
import { absoluteTime } from "@/lib/format";
import { env } from "@/lib/env";
import { ensureOrgTrust } from "@/lib/mothership/trust";
import { requireAdmin } from "@/lib/session";
import { lastResults, runChecks, SERVICES } from "@/lib/status";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

/** Re-run on load when the newest result is older than this. */
const STALE_MS = 30_000;

async function recheck() {
  "use server";
  await requireAdmin();
  await runChecks();
  revalidatePath("/status");
}

async function registerKey() {
  "use server";
  await requireAdmin();
  await ensureOrgTrust({ force: true }).catch(() => undefined);
  await runChecks();
  revalidatePath("/status");
}

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default async function StatusPage() {
  await requireAdmin();
  let results = await lastResults();
  const newest = Math.max(0, ...[...results.values()].map((r) => r.checkedAt.getTime()));
  if (Date.now() - newest > STALE_MS) {
    await runChecks();
    results = await lastResults();
  }

  return (
    <>
      <PageHeader
        title="Status"
      >
        <form action={recheck}>
          <button type="submit" className={buttonClass.secondary}>
            Check again
          </button>
        </form>
      </PageHeader>

      <ul className="divide-y divide-rule-soft overflow-hidden rounded-xl border border-rule bg-surface">
        {SERVICES.map((svc) => {
          const r = svc.check && svc.check !== "self" ? results.get(svc.check) : undefined;
          const ok = svc.check === "self" || (r?.ok ?? false);
          const warn = svc.check !== undefined && !ok;
          const detail = svc.check === "self" ? "Serving this page" : svc.check ? r?.detail : "No check from stadeum-ui";
          return (
            <li key={svc.service} className={`flex flex-wrap items-baseline gap-x-4 gap-y-2 px-5 py-[18px] ${warn ? "bg-warn-soft" : ""}`}>
              <span className="w-[120px] shrink-0 text-[13px]">
                {svc.check === "self" ? (
                  <Dot tone="ok" label="Running" />
                ) : !svc.check || !r ? (
                  <Dot tone="muted" label="Not checked" />
                ) : ok ? (
                  <Dot tone="ok" label="Passing" />
                ) : (
                  <Dot tone="attention" label="Needs attention" />
                )}
              </span>
              <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
                <span className="text-[15px] font-medium">
                  {svc.label} <span className="ml-1 font-mono text-[12px] font-normal text-ink-3">{svc.service}</span>
                </span>
                {detail && <span className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">{detail}</span>}
                {svc.check === "trust" && r && !ok && results.get("bifrost")?.ok && !env.orgKeyFile() && (
                  <form action={registerKey} className="mt-2">
                    <button type="submit" className="text-[13px] text-accent underline underline-offset-2 hover:text-accent-hover">
                      Register it now
                    </button>
                  </form>
                )}
              </span>
              <time
                className="tabular w-24 text-right text-[13px] text-ink-3"
                dateTime={r?.checkedAt.toISOString()}
                title={r ? `Last checked ${absoluteTime(r.checkedAt)}` : undefined}
              >
                {r ? clock(r.checkedAt) : ""}
              </time>
            </li>
          );
        })}
      </ul>
    </>
  );
}
