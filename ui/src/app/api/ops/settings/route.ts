import { hasDeploymentKey } from "@/lib/deployment-key";
import { settingsForOps } from "@/lib/ops/store";

/**
 * ops reads its settings here every tick (ui/src/lib/ops/contract.ts).
 * The deployment key only, and never through Caddy (stack/caddy/Caddyfile
 * answers /api/ops/* with 404): this carries the backup credentials.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasDeploymentKey(req.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await settingsForOps(), { headers: { "Cache-Control": "no-store" } });
}
