import { hasDeploymentKey } from "@/lib/deployment-key";
import { createGrantKey, grantKeyRefusal, grantKeyRequest } from "@/lib/mothership/grant-key";

/**
 * A grant's model key, for a machine outside strut (lib/mothership/grant-key.ts).
 * Strut calls it on the box's network with the deployment key and the
 * person's actor; Caddy's public site answers /api/mothership/* with 404.
 *
 *   POST { name, macaroon, max_cost_usd, expires_at } → 201 { id, key, address, expires_at }
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  if (!hasDeploymentKey(req.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const actor = req.headers.get("x-strut-actor")?.trim();
  if (!actor) return Response.json({ error: "x-strut-actor: the person the grant is for" }, { status: 400 });
  const parsed = grantKeyRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    return Response.json(await createGrantKey(actor, parsed.data), { status: 201, headers: NO_STORE });
  } catch (err) {
    return grantKeyRefusal(err);
  }
}
