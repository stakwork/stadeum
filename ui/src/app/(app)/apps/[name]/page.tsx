import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { adminApps, appHref, listApps } from "@/lib/apps";
import { requireUser } from "@/lib/session";
import { AppFrame, CannotOpen } from "../app-frame";
import { appName } from "../app-name";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }>; searchParams: Promise<{ input?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const name = appName((await params).name);
  const user = await requireUser();
  const apps = [...((await listApps()) ?? []), ...(await adminApps(user.role))];
  return { title: apps.find((a) => a.name === name)?.title ?? name };
}

/**
 * One of strut's apps, framed: the launcher's, or for an admin an
 * admin-only one; anyone else gets a 404 for it. The assistant is the
 * home, and Earnings has its own page, so they open there.
 */
export default async function AppPage({ params, searchParams }: Params) {
  const user = await requireUser();
  const name = appName((await params).name);
  const { input } = await searchParams;
  const apps = await listApps();
  if (!apps) return <CannotOpen title={name} />;

  const app = [...apps, ...(await adminApps(user.role))].find((a) => a.name === name);
  if (!app) notFound();
  const query = input ? `?${new URLSearchParams({ input })}` : "";
  if (app.assistant) redirect(`/${query}`);
  if (app.href !== appHref(app.name)) redirect(`${app.href}${query}`);
  return <AppFrame app={app} input={input} />;
}
