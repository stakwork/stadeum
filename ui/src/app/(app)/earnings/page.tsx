import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { earningsApp } from "@/lib/apps";
import { requireAdmin } from "@/lib/session";
import { AppFrame } from "../apps/app-frame";

export const metadata: Metadata = { title: "Earnings" };
export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<{ input?: string }> };

/**
 * Strut's Earnings (`strut/earnings`, its `specs/API.md` §14.14), framed for
 * an admin among the organisation's pages: the wallet, Add sats, Withdraw,
 * what paid runs earned. It is strut's app, signed in as the admin; stadeum
 * draws none of it and knows no payment (AGENTS.md rules 1 and 2). A strut
 * that lists no Earnings has no page here.
 */
export default async function EarningsPage({ searchParams }: Params) {
  const user = await requireAdmin();
  const app = await earningsApp(user.role);
  if (!app) notFound();
  return <AppFrame app={app} input={(await searchParams).input} />;
}
