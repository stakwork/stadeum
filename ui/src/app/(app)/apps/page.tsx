import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Dot } from "@/components/state";
import { managedApps, versionsHref, type ManagedApp } from "@/lib/app-admin";
import { liveLabel, pinNote } from "@/lib/app-versions";
import { requireAdmin } from "@/lib/session";
import { PinToggle } from "./manage";

export const metadata: Metadata = { title: "Apps" };
export const dynamic = "force-dynamic";

const td = "px-5 py-3.5";

/**
 * The apps strut serves, for an admin: what everyone gets when they open
 * each one, and the pin. An app's versions are one click in. A stadeum
 * page, not a frame: managing apps is admin work, and stadeum owns roles.
 */
export default async function AppsAdminPage() {
  await requireAdmin();
  const apps = await managedApps().catch((err: unknown) => {
    console.warn(`[apps] admin list failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  return (
    <>
      <PageHeader title="Apps" lede="What everyone gets when they open each app." />
      {!apps || apps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
          {apps ? "No apps yet." : "Strut isn’t answering, so the apps can’t be read right now."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
          <table className="w-full min-w-[600px] border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th scope="col" className="px-5 py-3 font-medium">
                  App
                </th>
                <th scope="col" className="w-[180px] px-5 py-3 font-medium">
                  What&rsquo;s live
                </th>
                <th scope="col" className="w-[76px] px-5 py-3 font-medium">
                  Drafts
                </th>
                <th scope="col" className="w-[120px] px-5 py-3 font-medium">
                  Warnings
                </th>
                <th scope="col" className="w-[104px] px-5 py-3 font-medium">
                  <span className="sr-only">Pin</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <Row key={a.name} app={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Row({ app: a }: { app: ManagedApp }) {
  return (
    <tr className="border-t border-rule-soft">
      <td className={td}>
        <Link href={versionsHref(a.name)} className="group flex flex-col gap-0.5">
          <span className="font-medium text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-4">
            {a.title}
          </span>
          <span className="font-mono text-[12.5px] text-ink-3">{a.name}</span>
        </Link>
      </td>
      <td className={`${td} text-[13.5px] text-ink-2`}>{a.seeded ? `Seeded by strut, ${a.active}` : liveLabel(a.active, a.live)}</td>
      <td className={`${td} tabular text-ink-2`}>{a.drafts || "—"}</td>
      <td className={`${td} text-[13px]`}>
        {a.warnings ? <Dot tone="attention" label={a.warnings === 1 ? "1 warning" : `${a.warnings} warnings`} /> : <span className="text-ink-3">{"—"}</span>}
      </td>
      <td className="px-5 py-2 text-right">
        {!a.seeded && <PinToggle name={a.name} pinned={a.pinned} note={pinNote(a.pinned, a.active, a.live)} />}
      </td>
    </tr>
  );
}
