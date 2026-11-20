import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * `Authorization: Bearer <SHARED_API_TOKEN>`, compared in constant time:
 * the routes for the box's network alone, which Caddy's public site 404s
 * (stack/caddy/Caddyfile): ops's (`/api/ops/*`) and strut's
 * (`/api/mothership/*`).
 */
export function hasDeploymentKey(authorization: string | null): boolean {
  const token = env.sharedToken();
  const given = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!token || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
