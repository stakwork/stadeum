import type { NextRequest } from "next/server";

import { connectable, fromTheBox, goTo, readAsk, refusal, signState, startUrl } from "@/lib/connect";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/session";

/**
 * A connect (lib/connect.ts), in two steps, so that it is always a person's
 * click on the box's own page:
 *
 * - `GET /api/connect/:provider[?return=&scope=&install=1&for=box]`, the
 *   link a package's app opens, shows the confirm page,
 *   `/connect/:provider` with the same parameters. It sends nobody to the
 *   provider: a link followed from anywhere lands on the page.
 * - `POST /api/connect/:provider` with the same parameters is the page's
 *   Continue. It is taken only from stadeum's own origin (`Origin`, never
 *   strut's or none), for the person signed in. It checks the ask again,
 *   signs the state then, so its hour starts at the click, and sends the
 *   person to the provider.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const p = connectable((await params).provider);
  if (!p) return new Response("Not found", { status: 404 });
  return goTo(`${env.publicUrl()}/connect/${p.id}${req.nextUrl.search}`, 303);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const p = connectable((await params).provider);
  if (!p) return new Response("Not found", { status: 404 });
  if (!fromTheBox(req.headers.get("origin"))) return refusal(403, `Connect ${p.name} from the box's own page.`);
  const user = await currentUser();
  if (!user) return refusal(401, "Sign in to the box, then connect again.");
  const checked = readAsk(p, user, req.nextUrl.searchParams);
  if (!checked.ok) return refusal(checked.status, checked.message, checked.back);
  const { back, scopes, box, install } = checked.ask;
  const state = signState({ provider: p.id, actor: user.actor, ...(box ? { for: "box" as const } : {}), return: back });
  return goTo(startUrl(p, { state, scopes, box, install }), 303);
}
