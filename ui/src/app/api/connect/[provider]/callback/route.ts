import type { NextRequest } from "next/server";

import { connectable, exchange, goTo, keep, refusal, verifyState } from "@/lib/connect";
import { isAdmin } from "@/lib/roles";
import { currentUser } from "@/lib/session";

/**
 * `GET /api/connect/:provider/callback?code=&state=`: the provider sends the
 * person back here, through the bounce on a box that has one
 * (lib/connect.ts). It refuses a state this box didn't sign for this
 * provider and this person within the hour, trades the code, writes the
 * tokens to strut, and sends the person to the state's `return`. It keeps
 * nothing, and logs no code or token.
 */
export const dynamic = "force-dynamic";

const WHY = {
  bad: "This link was not made by this box, or was changed.",
  expired: "This link is more than an hour old. Connect again.",
  "someone else": "This link was made for someone else. Sign in as them, or connect again.",
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const p = connectable((await params).provider);
  if (!p) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return refusal(401, "Sign in to the box, then connect again.");

  const q = req.nextUrl.searchParams;
  const checked = verifyState(q.get("state"), { provider: p.id, actor: user.actor });
  if (!checked.ok) return refusal(400, WHY[checked.why]);
  const s = checked.state;
  if (s.for === "box" && !isAdmin(user.role)) return refusal(403, "Only an admin connects for the box.", s.return);
  const error = q.get("error");
  if (error) return refusal(400, `The provider did not authorize it (${error.slice(0, 64)}).`, s.return);
  const code = q.get("code");
  if (!code) return refusal(400, "The provider sent no code.", s.return);

  const whose = s.for === "box" ? "the box" : user.actor;
  let got;
  try {
    got = await exchange(p, code);
  } catch (err) {
    console.warn(`[connect] ${p.id}: the token URL did not answer for ${whose}: ${err instanceof Error ? err.name : "error"}`);
    return refusal(502, "The provider did not answer. Try again.", s.return);
  }
  if (!got.ok) {
    console.warn(`[connect] ${p.id}: the code was not traded for ${whose}: ${got.error}`);
    return refusal(502, `The provider gave no token (${got.error}). Connect again.`, s.return);
  }
  try {
    await keep(got.secrets, s);
  } catch (err) {
    console.warn(`[connect] ${p.id}: strut did not keep the token for ${whose}: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return refusal(502, "Strut did not keep the token. Try again.", s.return);
  }
  return goTo(s.return);
}
