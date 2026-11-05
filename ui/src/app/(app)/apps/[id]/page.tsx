import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getApp } from "@/lib/apps";
import { env } from "@/lib/env";
import { ensureDelegation } from "@/lib/mothership/delegation";
import { requireUser } from "@/lib/session";
import { embedUrl } from "@/lib/strut/client";
import { StrutFrame } from "./strut-frame";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const app = await getApp((await params).id);
  return { title: app?.name ?? "App" };
}

/**
 * An app's page. A Strut app opens here in strut's UI, signed in as this
 * person with a fresh one-use ticket; any other app is not installed yet.
 */
export default async function AppPage({ params, searchParams }: Params) {
  const user = await requireUser();
  const app = await getApp((await params).id);
  if (!app) notFound();

  if (!app.strutApp) {
    return (
      <>
        <PageHeader title={app.name} lede={app.description} />
        <p className="rounded-xl border border-dashed border-dash px-5 py-10 text-center text-[14.5px] text-ink-2">
          Not installed yet.
        </p>
      </>
    );
  }

  const { run } = await searchParams;
  // Renews past half-life, as Hive does on every embed. Never throws.
  await ensureDelegation(user);
  const src = await embedUrl(user.actor, { wf: app.strutApp.wf, run }).catch(() => null);

  return (
    <div className="-mt-2 -mb-12 flex flex-col gap-4 md:-mt-4">
      <h1 className="font-serif text-[28px] leading-tight tracking-[-0.015em] md:text-[32px]">{app.name}</h1>
      {src ? (
        <StrutFrame src={src} origin={new URL(env.strutPublicUrl()).origin} title={app.name} />
      ) : (
        <p className="rounded-xl border border-dashed border-dash px-5 py-10 text-center text-[14.5px] text-ink-2">
          {app.name} can&rsquo;t open right now.
        </p>
      )}
    </div>
  );
}
