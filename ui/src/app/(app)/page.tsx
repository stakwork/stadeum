import Link from "next/link";

import { PageHeader, SectionLabel } from "@/components/page-header";
import { listApps } from "@/lib/apps";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireUser();
  const apps = await listApps();

  return (
    <>
      <PageHeader title="Home" />

      <section aria-labelledby="apps" className="flex flex-col gap-3 md:gap-4">
        <SectionLabel id="apps">Apps</SectionLabel>
        {apps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
            No apps yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            {apps.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.entry}
                  className="flex h-full min-h-[88px] flex-col gap-1.5 rounded-xl border border-rule bg-surface p-4 text-ink transition-[border-color,transform] duration-150 hover:border-rule-strong active:scale-[0.99] md:gap-2 md:p-5"
                >
                  <span className="font-serif text-[19px] leading-tight md:text-[21px]">
                    {a.name}
                  </span>
                  <span className="text-[12px] leading-[1.45] text-ink-3 md:text-[13px] md:leading-normal">
                    {a.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* No app records activity yet. */}
      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <SectionLabel id="recent">Recent activity</SectionLabel>
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
          Nothing yet.
        </p>
      </section>
    </>
  );
}
