import type { NextRequest } from "next/server";

import { connectable, fromStrut, refreshAccess } from "@/lib/connect";
import { env } from "@/lib/env";

/**
 * `POST /api/connect/:provider/refresh { refresh_token }`: strut, for a
 * person's secret whose access token is running out (lib/connect.ts).
 * Refreshing needs the provider's client secret, which only stadeum-ui
 * holds. Strut alone calls it, with `Authorization: Bearer <CONNECT_TOKEN>`,
 * on the box's network: Caddy's public site 404s it
 * (stack/caddy/Caddyfile).
 *
 * It answers `200 { access_token, expires_in, refresh_token? }`, the last
 * only when the provider rotated it; `400 { error: "invalid_grant" }` when
 * the provider refuses the refresh token, and for nothing else: strut then
 * deletes the secret (strut specs/API.md §8.2); `502 { error }` when the
 * provider doesn't answer, or answers anything else; `401` for any other
 * bearer; `422` for a body with no refresh token. Without CONNECT_TOKEN,
 * and for a provider with no `refresh`, it is a 404. Strut keeps the secret
 * on all but the 400. It keeps and logs nothing.
 */
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  if (!env.connectToken()) return json(404, { error: "not found" });
  if (!fromStrut(req.headers.get("authorization"))) return json(401, { error: "unauthorized" });
  const p = connectable((await params).provider);
  if (!p?.refresh) return json(404, { error: "not found" });

  const body = (await req.json().catch(() => undefined)) as { refresh_token?: unknown } | undefined;
  const refreshToken = body?.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) return json(422, { error: "refresh_token is required" });

  let got;
  try {
    got = await refreshAccess(p, refreshToken);
  } catch {
    return json(502, { error: "the provider did not answer" });
  }
  if (!got.ok) return json(got.status, { error: got.error });
  const { access_token, expires_in, refresh_token } = got;
  return json(200, { access_token, expires_in, ...(refresh_token ? { refresh_token } : {}) });
}
