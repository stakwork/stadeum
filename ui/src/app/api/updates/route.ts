import { liveUpdates } from "@/lib/ops/store";
import { isAdmin } from "@/lib/roles";
import { currentUser } from "@/lib/session";

/**
 * `GET /api/updates`: the Updates page's live part (lib/ops/progress.ts),
 * re-read by the page while a Check now or Update now is open. A route,
 * not a server action: a release recreates stadeum-ui while the page
 * waits, and the page's old code must still be able to read the outcome.
 * It says what ops is doing, never a credential.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user || !isAdmin(user.role)) return Response.json({ error: "admins only" }, { status: 403, headers: { "cache-control": "no-store" } });
  return Response.json(await liveUpdates(), { headers: { "cache-control": "no-store" } });
}
