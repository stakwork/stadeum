import { BifrostHttpError, jsonClient } from "./http";
import type {
  AgentCatalogManifest,
  CostPoint,
  GatewayPriceRow,
  HistogramResponse,
  ModelSpendRow,
  SpendResponse,
  SpendWindow,
  TokenPoint,
  TrustOrgRow,
  TrustOrgUpsert,
  TrustStatusResponse,
  UserSpendRow,
} from "./types";

/**
 * Client for the gateway plugin's `/_plugin/*` routes (Bearer provisioning
 * token = `SHARED_API_TOKEN`). Ported from Hive
 * `src/services/bifrost/BifrostPluginClient.ts`, minus the Hive callback;
 * `getAdminCredentials` comes from Hive `bootstrap.ts`.
 */

export interface BifrostPluginClientOptions {
  baseUrl: string;
  provisioningToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class BifrostPluginClient {
  private readonly request: ReturnType<typeof jsonClient>;

  constructor(opts: BifrostPluginClientOptions) {
    this.request = jsonClient({
      baseUrl: opts.baseUrl,
      authHeader: `Bearer ${opts.provisioningToken}`,
      label: "Bifrost plugin",
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
  }

  /** GET /_plugin/admin-credentials — the Basic creds for `/api/*`. */
  async getAdminCredentials(): Promise<{ admin_username: string; admin_password: string }> {
    const body = await this.request<{ admin_username?: unknown; admin_password?: unknown }>(
      "GET",
      "/_plugin/admin-credentials",
    );
    if (!body || typeof body.admin_username !== "string" || typeof body.admin_password !== "string" || !body.admin_password) {
      throw new BifrostHttpError(200, body, "Bifrost admin-credentials returned an unexpected payload shape");
    }
    return { admin_username: body.admin_username, admin_password: body.admin_password };
  }

  getTrustStatus() {
    return this.request<TrustStatusResponse>("GET", "/_plugin/trust/status");
  }

  /** `null` on 404 (org not registered). */
  async getTrustOrg(orgId: string): Promise<TrustOrgRow | null> {
    try {
      return await this.request<TrustOrgRow>("GET", `/_plugin/trust/${encodeURIComponent(orgId)}`);
    } catch (err) {
      if (err instanceof BifrostHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** POST /_plugin/trust — register or replace an org. Idempotent. */
  upsertTrust(input: TrustOrgUpsert) {
    return this.request<{ ok: boolean; org_id: string }>("POST", "/_plugin/trust", input);
  }

  setRealmId(realmId: string) {
    return this.request<{ ok: boolean; realm_id: string }>("PUT", "/_plugin/trust/realm_id", { realm_id: realmId });
  }

  /** POST /_plugin/agents — replace-by-source agent catalog seed. */
  seedAgentCatalog(manifest: AgentCatalogManifest) {
    return this.request<unknown>("POST", "/_plugin/agents", manifest);
  }

  /**
   * Replace the gateway's runtime price table (stakgraph gateway, v0.4.398
   * and later): rows keyed `<provider>/<model>`, consulted after the
   * config's `model_pricing` and before bifrost's datasheet. A row of zeros
   * marks a free model.
   */
  putPricing(table: Record<string, GatewayPriceRow>) {
    return this.request<unknown>("PUT", "/_plugin/pricing", table);
  }

  /** Spend per person (by the macaroon's `user_id`, the actor) over a rolling window. */
  spendByUser(window: SpendWindow) {
    return this.request<SpendResponse<UserSpendRow>>("GET", `/_plugin/spend/by-user?window=${window}`);
  }

  /** Spend per (provider, model) over a rolling window. */
  spendByModel(window: SpendWindow) {
    return this.request<SpendResponse<ModelSpendRow>>("GET", `/_plugin/spend/by-model?window=${window}`);
  }

  /** Cost per bucket, epoch-aligned (`1d` = UTC days). */
  costHistogram(window: SpendWindow, bucket: "1h" | "1d") {
    return this.request<HistogramResponse<CostPoint>>("GET", `/_plugin/histogram/cost?window=${window}&bucket=${bucket}`);
  }

  /** Tokens per bucket, split into prompt and completion. */
  tokenHistogram(window: SpendWindow, bucket: "1h" | "1d") {
    return this.request<HistogramResponse<TokenPoint>>("GET", `/_plugin/histogram/tokens?window=${window}&bucket=${bucket}`);
  }
}
