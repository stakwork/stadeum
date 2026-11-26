import { resolveApiKey, type ApiKeyScope } from "@/lib/api-keys";

/**
 * Authenticates a request to `/api/v1/*` by API key: `Authorization:
 * Bearer <key>`, or `x-api-key`. A missing, unknown or revoked key is 401;
 * a read-only key on anything but GET, HEAD or OPTIONS is 403. A key is
 * the box's own (one organisation), so there is no other workspace to
 * name. Use `withApiKey` around a route handler.
 */

export type ApiKeyAuth = { keyId: string; scope: ApiKeyScope; createdById: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });

export function apiKeyFrom(req: Request): string | null {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return bearer?.[1] ?? req.headers.get("x-api-key")?.trim() ?? null;
}

export async function authenticateApiKey(req: Request): Promise<{ ok: true; auth: ApiKeyAuth } | { ok: false; response: Response }> {
  const secret = apiKeyFrom(req);
  const key = secret ? await resolveApiKey(secret) : null;
  if (!key) return { ok: false, response: refuse(401, "invalid or missing API key", { "WWW-Authenticate": "Bearer" }) };
  if (key.scope === "read" && !SAFE_METHODS.has(req.method.toUpperCase())) {
    return { ok: false, response: refuse(403, "this API key is read-only") };
  }
  return { ok: true, auth: { keyId: key.id, scope: key.scope, createdById: key.createdById } };
}

export function withApiKey<A extends unknown[]>(handler: (req: Request, auth: ApiKeyAuth, ...rest: A) => Promise<Response> | Response) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const result = await authenticateApiKey(req);
    if (!result.ok) return result.response;
    const res = await handler(req, result.auth, ...rest);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
}
