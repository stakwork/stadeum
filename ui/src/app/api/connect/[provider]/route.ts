import type { NextRequest } from "next/server";

import { askedScopes, connectable, goTo, refusal, safeReturn, signState, startUrl } from "@/lib/connect";
import { isAdmin } from "@/lib/roles";
import { currentUser } from "@/lib/session";

/**
 * `GET /api/connect/:provider[?return=&scope=&install=1&for=box]`: a
 * signed-in person starts a connect (lib/connect.ts). `return` is a page on
 * the box's own origins; each scope is one the provider lists; `install=1`
 * starts at its install page; `for=box` is an admin's, and the tokens become
 * the box's. It signs a state and sends the person to the provider.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const p = connectable((await params).provider);
  if (!p) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return refusal(401, "Sign in to the box, then connect again.");
  // Another site can't start a connect for the person signed in here: a box token is an admin's click.
  if (req.headers.get("sec-fetch-site") === "cross-site") return refusal(403, "A connect starts from the box's own pages.");

  const q = req.nextUrl.searchParams;
  const back = safeReturn(q.get("return"));
  if (!back) return refusal(400, "The page to come back to is not on this box.");
  const forBox = q.get("for");
  if (forBox !== null && forBox !== "box") return refusal(400, "for can only be box.", back);
  if (forBox && !isAdmin(user.role)) return refusal(403, "Only an admin connects for the box.", back);
  const scopes = askedScopes(p, q.get("scope"));
  if (!scopes) {
    return refusal(400, p.scopes.length ? `A scope asked for is not one of ${p.scopes.join(", ")}.` : "This provider takes no scope.", back);
  }
  const install = q.get("install") === "1";
  if (install && !p.install) return refusal(400, "This provider has no install page here.", back);

  const state = signState({ provider: p.id, actor: user.actor, ...(forBox ? { for: "box" as const } : {}), return: back });
  return goTo(startUrl(p, { state, scopes, box: !!forBox, install }));
}
