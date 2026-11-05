/** Wire shapes, ported from Hive `src/services/bifrost/types.ts`. */

/** A provider as bifrost names it: one of PROVIDERS, or one an admin added. */
export type BifrostProvider = string;

export interface BifrostBudget {
  id?: string;
  max_limit: number;
  reset_duration: string;
  current_usage?: number;
  last_reset?: string;
}

export interface BifrostRateLimit {
  id?: string;
  request_max_limit?: number | null;
  request_reset_duration?: string | null;
  token_max_limit?: number | null;
  token_reset_duration?: string | null;
}

export interface BifrostCustomer {
  id: string;
  name: string;
  budget?: BifrostBudget;
  rate_limit?: BifrostRateLimit | null;
  created_at: string;
  updated_at?: string;
}

export interface BifrostProviderConfig {
  id?: number;
  provider: string;
  weight?: number | null;
  allowed_models: string[];
  key_ids?: string[];
  blacklisted_models?: string[];
  allow_all_keys?: boolean;
  keys?: Array<{ key_id?: string }>;
}

export interface BifrostVirtualKey {
  id: string;
  name: string;
  description?: string;
  /** `sk-bf-…` bearer token. */
  value: string;
  is_active?: boolean;
  customer_id?: string | null;
  provider_configs?: BifrostProviderConfig[];
  created_at: string;
  updated_at?: string;
}

export interface ListCustomersResponse {
  customers: BifrostCustomer[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
}

export interface CreateCustomerResponse {
  message: string;
  customer: BifrostCustomer;
}

export interface ListVirtualKeysResponse {
  virtual_keys: BifrostVirtualKey[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
}

export interface VirtualKeyResponse {
  message?: string;
  virtual_key: BifrostVirtualKey;
}

/** One provider of `GET /api/providers`. A custom one carries `custom_provider_config`. */
export interface BifrostProviderEntry {
  name: string;
  provider_status?: string;
  network_config?: { base_url?: string; allow_private_network?: boolean };
  custom_provider_config?: { base_provider_type?: string } | null;
}

export interface ListProvidersResponse {
  providers: BifrostProviderEntry[];
  total: number;
}

/**
 * `POST /api/providers` for an OpenAI-compatible custom provider. Its
 * payload has no `keys`: a key sent here is dropped without an error, so
 * the key is a second call (bifrost handlers/providers.go:125-136).
 */
export interface BifrostCustomProviderInput {
  provider: string;
  network_config: { base_url: string; allow_private_network?: boolean };
  custom_provider_config: { base_provider_type: "openai" };
}

/** One row of the gateway's runtime price table (`PUT /_plugin/pricing`): USD per million tokens. */
export interface GatewayPriceRow {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok?: number;
  cache_write_per_mtok?: number;
}

/**
 * One provider key as `GET /api/providers/:p/keys` returns it: redacted.
 * `value` is a masked preview, or `{ value, ref, type }` for a key read
 * from an env variable (`value` is "" when that variable is unset).
 */
export interface BifrostKey {
  id: string;
  name: string;
  value?: string | { value?: string; ref?: string; type?: string };
  models?: string[];
  weight?: number;
  /** bifrost's last list-models call with the key: `success` or `list_models_failed`. */
  status?: string;
  /** Why that call failed, in the provider's words. */
  description?: string;
}

export interface ListProviderKeysResponse {
  keys: BifrostKey[];
  total: number;
}

/** What stadeum writes to a key: the whole key, since bifrost's PUT replaces it. */
export interface BifrostKeyInput {
  name: string;
  value: string;
  models: string[];
  weight: number;
}

/** `GET /api/config`: only the client section, which stadeum reads back whole. */
export interface BifrostConfigResponse {
  client_config: Record<string, unknown> & { log_retention_days?: number };
}

export interface BifrostAdminCreds {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
}

// ── Trust registry (`/_plugin/trust*`) ───────────────────────────────────

export interface TrustStatusResponse {
  claimed: boolean;
  org_count: number;
  orgs: string[];
  seed_source: "env" | "api" | "" | null;
  last_modified: string;
  realm_id?: string;
}

export interface TrustOrgUpsert {
  org_id: string;
  pubkey: string;
  issuer_url: string;
  revocation_poll_seconds: number;
}

export interface TrustOrgRow extends TrustOrgUpsert {
  grace_pubkeys?: string[];
  grace_until?: string;
}

export interface AgentCatalogManifest {
  source: string;
  agents: Array<{ name: string; display_name?: string; description?: string; default_model?: string }>;
}
