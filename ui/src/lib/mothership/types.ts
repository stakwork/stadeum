/** Wire shapes, ported from Hive `src/services/bifrost/types.ts`. */

export type BifrostProvider = "anthropic" | "openai" | "openrouter" | "gemini" | "xai";

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

export interface ListProvidersResponse {
  providers: Array<{ name: string; provider_status?: string }>;
  total: number;
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
