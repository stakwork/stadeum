import type { BifrostClient } from "./bifrost-client";
import { governanceClient } from "./admin-credentials";
import { GATEWAY_LOG_RETENTION_DAYS } from "./constants";

/**
 * The gateway's request log keeps each call's prompt and reply. Stadeum keeps
 * it 60 days, not the image's 365 (docs/models.md, "Rulings"). Bifrost's
 * `PUT /api/config` copies most client fields from the body, so the section
 * is read back whole and sent with only this one changed. The PUT also
 * writes out defaults the GET leaves unset (`prefer_idp`, `headers`, 3600)
 * and the deprecated mirrors of `enforce_auth_on_inference`: no change in
 * behavior, checked against bifrost v2.2.2 on 2026-11-05. An edit made
 * through the API survives restarts while the gateway's config.json is
 * unchanged; this runs on every reconcile pass anyway.
 */
export async function ensureGatewayLogRetention(client?: BifrostClient): Promise<"kept" | "set"> {
  const c = client ?? (await governanceClient());
  const { client_config } = await c.getConfig();
  if (client_config.log_retention_days === GATEWAY_LOG_RETENTION_DAYS) return "kept";
  await c.updateClientConfig({ ...client_config, log_retention_days: GATEWAY_LOG_RETENTION_DAYS });
  return "set";
}
