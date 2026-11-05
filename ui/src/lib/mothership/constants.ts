/**
 * Defaults ported from Hive `src/services/bifrost/constants.ts`. Only the
 * values stadeum uses are kept.
 */

import type { BifrostProvider, BifrostRateLimit } from "./types";

/** Customer-level daily spend cap in USD. */
export const DEFAULT_CUSTOMER_BUDGET_USD = 1000.0;
export const DEFAULT_BUDGET_RESET_DURATION = "1d";

/**
 * A request ceiling only. No token-per-minute limit: Bifrost counts cached
 * prompt tokens against it, so long cached agent contexts trip it on
 * ordinary use. The daily budget is the spend ceiling.
 */
export const DEFAULT_CUSTOMER_RATE_LIMIT: BifrostRateLimit = {
  request_max_limit: 1000,
  request_reset_duration: "1m",
};

/**
 * The providers an admin sets a key for on the Models page: bifrost's name,
 * strut's (aieo's) name for the same provider, and what a person reads.
 * Each is in the gateway's baked config.json, with one key slot read from
 * an env variable that stadeum no longer sets.
 */
export const PROVIDERS = [
  { id: "anthropic", strut: "anthropic", label: "Anthropic" },
  { id: "openai", strut: "openai", label: "OpenAI" },
  { id: "gemini", strut: "google", label: "Google" },
  { id: "xai", strut: "xai", label: "xAI" },
  { id: "openrouter", strut: "openrouter", label: "OpenRouter" },
] as const;

/** Providers a VK may call, narrowed to what the gateway has configured. */
export const DEFAULT_PROVIDERS: BifrostProvider[] = PROVIDERS.map((p) => p.id);

/** How long the gateway keeps its request log (prompts included); its image ships 365. */
export const GATEWAY_LOG_RETENTION_DAYS = 60;

export const BIFROST_HTTP_TIMEOUT_MS = 15_000;

/** `revocation_poll_seconds` on the trust entry (required, not yet polled). */
export const DEFAULT_REVOCATION_POLL_SECONDS = 60;

/** Macaroon org_id = `stadeum_<STADEUM_ORG_SLUG>`. */
export const MACAROON_ORG_ID_PREFIX = "stadeum_";

/** The agent the standing invocation authorizes. */
export const STRUT_DELEGATION_AGENT = "strut-agent";

/** Agents seeded into the gateway's catalog (best-effort). */
export const AGENT_CATALOG_SOURCE = "stadeum";
export const AGENT_CATALOG_AGENTS = ["strut-agent", "strut-assistant"];

/** Cumulative per-person cap on everything spent through Strut. */
export const STRUT_DELEGATION_DEFAULT_MAX_COST_USD = 10_000;

/** Lifetime of the standing invocation and its UA: 60 days. */
export const STRUT_DELEGATION_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Re-mint a delegation this close to its expiry. */
export const STRUT_DELEGATION_RENEW_WITHIN_MS = 15 * 24 * 60 * 60 * 1000;
