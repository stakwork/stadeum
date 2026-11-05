import { jsonClient } from "./http";
import type {
  BifrostBudget,
  BifrostProvider,
  BifrostRateLimit,
  CreateCustomerResponse,
  ListCustomersResponse,
  ListProvidersResponse,
  ListVirtualKeysResponse,
  VirtualKeyResponse,
} from "./types";

/**
 * Bifrost governance client (`/api/*`, Basic admin auth). Ported from Hive
 * `src/services/bifrost/BifrostClient.ts`; the customer get/update used
 * only by Hive's token-limit migration is dropped.
 */

export interface BifrostClientOptions {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ProviderConfigInput {
  id?: number;
  provider: BifrostProvider | string;
  allowed_models: string[];
  blacklisted_models?: string[];
  weight?: number | null;
  /** `["*"]` = every provider key on the gateway. Omitted = none, and
   *  inference fails with "no keys found for provider". */
  key_ids?: string[];
}

export class BifrostClient {
  private readonly request: ReturnType<typeof jsonClient>;

  constructor(opts: BifrostClientOptions) {
    const token = Buffer.from(`${opts.adminUser}:${opts.adminPassword}`, "utf-8").toString("base64");
    this.request = jsonClient({
      baseUrl: opts.baseUrl,
      authHeader: `Basic ${token}`,
      label: "Bifrost",
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
  }

  listCustomers(params: { search?: string; limit?: number; offset?: number } = {}) {
    return this.request<ListCustomersResponse>("GET", `/api/governance/customers${buildQuery(params)}`);
  }

  createCustomer(input: { name: string; budget?: BifrostBudget; rate_limit?: BifrostRateLimit }) {
    return this.request<CreateCustomerResponse>("POST", `/api/governance/customers`, input);
  }

  listVirtualKeys(params: { search?: string; customer_id?: string; limit?: number; offset?: number } = {}) {
    return this.request<ListVirtualKeysResponse>("GET", `/api/governance/virtual-keys${buildQuery(params)}`);
  }

  createVirtualKey(input: {
    name: string;
    description?: string;
    customer_id: string;
    provider_configs: ProviderConfigInput[];
  }) {
    return this.request<VirtualKeyResponse>("POST", `/api/governance/virtual-keys`, input);
  }

  getVirtualKey(vkId: string) {
    return this.request<VirtualKeyResponse>("GET", `/api/governance/virtual-keys/${encodeURIComponent(vkId)}`);
  }

  /** Bifrost REPLACES the VK's provider_configs with this set: always send all of them. */
  updateVirtualKey(vkId: string, input: { provider_configs: ProviderConfigInput[] }) {
    return this.request<VirtualKeyResponse>("PUT", `/api/governance/virtual-keys/${encodeURIComponent(vkId)}`, input);
  }

  listProviders() {
    return this.request<ListProvidersResponse>("GET", `/api/providers`);
  }
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
