import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { CallPanel } from "./call-panel";

export const metadata: Metadata = { title: "Calls" };

/**
 * A voice call with the assistant. The call itself is held by the `(app)`
 * layout (components/call.tsx), so it goes on when the person leaves this
 * page; this page starts it and shows it.
 */
export default async function CallsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Calls" lede="Talk it through by voice. The call keeps going while you use the rest of stadeum." />
      <CallPanel />
    </>
  );
}
