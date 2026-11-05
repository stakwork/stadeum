import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { listApps } from "@/lib/apps";
import { requireUser } from "@/lib/session";
import { AppFrame, CannotOpen } from "../app-frame";
import { appName } from "../app-name";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }>; searchParams: Promise<{ input?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const name = appName((await params).name);
  return { title: (await listApps())?.find((a) => a.name === name)?.title ?? name };
}

/** One of strut's apps, framed. The assistant is the home, so it opens there. */
export default async function AppPage({ params, searchParams }: Params) {
  await requireUser();
  const name = appName((await params).name);
  const { input } = await searchParams;
  const apps = await listApps();
  if (!apps) return <CannotOpen title={name} />;

  const app = apps.find((a) => a.name === name);
  if (!app) notFound();
  if (app.assistant) redirect(input ? `/?${new URLSearchParams({ input })}` : "/");
  return <AppFrame app={app} input={input} />;
}
