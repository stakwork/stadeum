import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { listApps } from "@/lib/apps";
import { requireUser } from "@/lib/session";
import { AppFrame } from "./apps/app-frame";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ input?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await listApps())?.find((a) => a.assistant)?.title ?? "Home" };
}

/**
 * The home is the assistant, Jamie, when strut lists it. Without it, the
 * home lists strut's apps, which the rail lists too.
 */
export default async function Home({ searchParams }: Props) {
  await requireUser();
  const apps = await listApps();
  const assistant = apps?.find((a) => a.assistant);
  if (assistant) return <AppFrame app={assistant} input={(await searchParams).input} />;

  return (
    <>
      <PageHeader title="Home" />
      {!apps || apps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
          {apps ? "No apps yet." : "Strut isn’t answering, so no apps can open right now."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          {apps.map((a) => (
            <li key={a.name}>
              <Link
                href={a.href}
                className="flex h-full min-h-[88px] flex-col gap-1.5 rounded-xl border border-rule bg-surface p-4 text-ink transition-[border-color,transform] duration-150 hover:border-rule-strong active:scale-[0.99] md:gap-2 md:p-5"
              >
                <span className="font-serif text-[19px] leading-tight md:text-[21px]">{a.title}</span>
                {a.description && (
                  <span className="line-clamp-3 text-[12px] leading-[1.45] text-ink-3 md:text-[13px] md:leading-normal">
                    {a.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
