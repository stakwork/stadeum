import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { CallScreen } from "./call-panel";

export const metadata: Metadata = { title: "Calls" };

/**
 * A voice call with the assistant. The call itself is held by the `(app)`
 * layout (components/call.tsx), so it goes on when the person leaves this
 * page; this page starts it and shows it, whole: no header, the call is
 * the page.
 */
export default async function CallsPage() {
  await requireUser();
  return <CallScreen />;
}
