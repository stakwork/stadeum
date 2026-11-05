import { env } from "@/lib/env";
import { STRUT_HTTP_TIMEOUT_MS } from "@/lib/mothership/constants";

/**
 * Hosting a Strut app inside stadeum. The shared token never leaves the
 * server; the browser only ever gets a per-person mint-token JWT.
 */

export class StrutUnavailableError extends Error {}

/**
 * `POST {mcp}/mint-token` → a JWT whose `sub` is the actor, then the
 * embed URL `{public mcp}/lab/?key=<jwt>&embed_origin=<us>`. The trailing
 * slash matters: mcp 308s a bare `/lab`, dropping `?key=`. Ported from
 * Hive `src/services/strut-embed.ts:45-136`.
 */
export async function mintEmbedUrl(
  actor: string,
  deepLink: { wf?: string; run?: string } = {},
  ttl = "1h",
): Promise<{ url: string; expiresIn: string }> {
  const token = env.sharedToken();
  if (!token) throw new StrutUnavailableError("SHARED_API_TOKEN is not set");
  let res: Response;
  try {
    res = await fetch(`${env.mcpUrl()}/mint-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": token },
      body: JSON.stringify({ expires_in: ttl, sub: actor }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new StrutUnavailableError(`Strut token mint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new StrutUnavailableError(`Strut token mint failed (${res.status})`);
  const body = (await res.json()) as { token?: string };
  if (!body?.token) throw new StrutUnavailableError("Strut token mint returned no token");

  const url = new URL(`${env.mcpPublicUrl()}/lab/`);
  url.searchParams.set("key", body.token);
  url.searchParams.set("embed_origin", new URL(env.publicUrl()).origin);
  if (deepLink.wf) url.searchParams.set("wf", deepLink.wf);
  if (deepLink.run) url.searchParams.set("run", deepLink.run);
  return { url: url.toString(), expiresIn: ttl };
}
