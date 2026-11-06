/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are arbitrary JSON in a test fake */
/**
 * A fake of the stadeum stack on one port, for tests and local runs:
 *   /bifrost  — gateway: /_plugin/* (Bearer) and /api/* (Basic): customers,
 *               virtual keys, each provider's keys and their check, the
 *               client config (bifrost transports/v2.2.2 handlers)
 *   /strut    — strut: /health, /apps (the list, each app's versions,
 *               usage, what is live and the pin), /brand, /auth/ticket and
 *               the app page a ticket opens, /llm/delegations, /llm/models,
 *               /secrets/:name, /actors/:actor/secrets (strut specs/API.md)
 *   /neo4j    — HTTP discovery
 * Wire shapes follow docs/mothership-spec.md. The delegation PUT runs
 * Strut's own shape check and verifies the macaroon against the org key
 * the trust registry holds, like the real gateway would.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeMacaroon, verify } from "gatekey";

import { brandStyles } from "@/lib/brand";
import type { StrutBrand } from "@/lib/strut/client";
import { brandProblem, normalizeBrand } from "./strut-brand";
import { checkDelegationShape } from "./strut-shape";

export interface FakeStackOptions {
  token?: string;
  adminUser?: string;
  adminPass?: string;
  providers?: string[];
}

/** One entry of strut's `GET /apps` (specs/API.md §14, `AppListEntry`). */
export interface FakeApp {
  name: string;
  activeVersion: string;
  versions: string[];
  title: string;
  description?: string;
  icon?: string;
  grants: { workflows: string[]; steps: string[]; sqlite: boolean; automations: string[] };
  publisher?: string;
  owner?: string;
  pinned?: boolean;
  live?: string;
}

const grants = (workflows: string[] = [], steps: string[] = []) => ({ workflows, steps, sqlite: false, automations: [] });

/** What strut seeds on every server: its component library and Jamie. */
export const SEEDED_APPS: FakeApp[] = [
  { name: "strut/views", activeVersion: "v1", versions: ["v1"], title: "strut views", icon: "layout-grid", grants: grants(), publisher: "strut" },
  {
    name: "strut/jamie",
    activeVersion: "v1",
    versions: ["v1"],
    title: "Jamie",
    description: "Jamie, the person's assistant.",
    icon: "message-circle",
    grants: grants(["orchestrator", "job", "builder"], ["conversation/list", "conversation/get"]),
    publisher: "strut",
  },
];

/** What `GET /apps/:name/versions` and `/usage` read beyond the listing. */
export interface FakeAppRecord {
  versions: Record<string, { createdAt: string; source?: string }>;
  /** Oldest first. Strut keeps every release. */
  releases: Array<{ id: string; version: string; createdAt: string; by?: string }>;
  /** `GET /apps/:name/usage`'s warnings; `GET /apps` counts the live version's. */
  warnings: Array<{ kind: string; version: string; times: number; lastAt: string; message: string; fix: string }>;
}

const seededRecord = (): FakeAppRecord => ({ versions: { v1: { createdAt: "2026-11-05T12:00:00.000Z", source: "seed" } }, releases: [], warnings: [] });
const versionNumber = (v: string) => Number(v.replace(/^v/, "")) || 0;

/** One provider key as bifrost stores it: a plain value, or a slot read from an env variable. */
export interface FakeKey {
  id: string;
  name: string;
  value: string | { value: string; ref: string; type: "env" };
  models: string[];
  weight: number;
  status?: string;
  description?: string;
}

/** strut's `GET /llm/models` (aieo's aliases, strut src/llm.ts `listModelOptions`). */
export const FAKE_MODEL_CATALOG = {
  default: "anthropic/claude-sonnet-5-5",
  models: [
    { provider: "anthropic", alias: "sonnet", modelId: "claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5", default: true, available: false },
    { provider: "anthropic", alias: "opus", modelId: "claude-opus-5-5", name: "anthropic/claude-opus-5-5", default: false, available: false },
    { provider: "google", alias: "gemini", modelId: "gemini-3.8-flash", name: "google/gemini-3.8-flash", default: true, available: false },
    { provider: "openai", alias: "gpt", modelId: "gpt-5.6-luna", name: "openai/gpt-5.6-luna", default: true, available: false },
    { provider: "openrouter", alias: "kimi", modelId: "moonshotai/kimi-k3", name: "openrouter/moonshotai/kimi-k3", default: true, available: false },
    { provider: "maple", alias: "maple", modelId: "gemma4-31b", name: "maple/gemma4-31b", default: true, available: false, pricing: { inputTokenPrice: 0.8, outputTokenPrice: 2 } },
    { provider: "maple", modelId: "gpt-oss-120b", name: "maple/gpt-oss-120b", default: false, available: false, pricing: { inputTokenPrice: 0.3, outputTokenPrice: 1.2 } },
    { provider: "numes", alias: "numes", modelId: "z-ai/glm-5.3", name: "numes/z-ai/glm-5.3", default: true, available: false, pricing: { inputTokenPrice: 0, outputTokenPrice: 0 } },
  ],
  keyNames: { anthropic: "ANTHROPIC_API_KEY" },
};

/** What bifrost's GET shows of a key: a masked preview, never the value. */
const redactKey = (k: FakeKey) => ({
  ...k,
  value: typeof k.value === "string" ? `${k.value.slice(0, 3)}****${k.value.slice(-4)}` : { ...k.value, value: k.value.value ? "****" : "" },
});

/** One logged model call. */
export interface FakeCall {
  ts: string;
  user_id: string;
  provider: string;
  model: string;
  cost: number;
  prompt_tokens: number;
  completion_tokens: number;
}

const WINDOW_MS: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5 };

/** The gateway's rollups over its logged calls (`/_plugin/spend/*`, `/_plugin/histogram/*`). */
function rollup(calls: FakeCall[], path: string, url: URL) {
  const window = url.searchParams.get("window") ?? "24h";
  const since = Date.now() - (WINDOW_MS[window] ?? 864e5);
  const rows = calls.filter((c) => Date.parse(c.ts) >= since);
  const group = (key: (c: FakeCall) => string) => {
    const out = new Map<string, FakeCall[]>();
    for (const c of rows) out.set(key(c), [...(out.get(key(c)) ?? []), c]);
    return [...out];
  };
  const sum = (cs: FakeCall[]) => ({
    total_cost: cs.reduce((a, c) => a + c.cost, 0),
    total_tokens: cs.reduce((a, c) => a + c.prompt_tokens + c.completion_tokens, 0),
    request_count: cs.length,
  });
  if (path === "/_plugin/spend/by-user") {
    return { window, results: group((c) => c.user_id).map(([user_id, cs]) => ({ user_id, user_name: user_id, ...sum(cs) })) };
  }
  if (path === "/_plugin/spend/by-model") {
    const results = group((c) => JSON.stringify([c.provider, c.model])).map(([k, cs]) => {
      const [provider, model] = JSON.parse(k) as [string, string];
      return { provider, model, ...sum(cs) };
    });
    return { window, results };
  }
  const size = url.searchParams.get("bucket") === "1h" ? 3600 : 86400;
  const bucket = (c: FakeCall) => new Date(Math.floor(Date.parse(c.ts) / (size * 1000)) * size * 1000).toISOString();
  const points = group(bucket).map(([ts, cs]) =>
    path === "/_plugin/histogram/cost"
      ? { ts, cost: sum(cs).total_cost }
      : {
          ts,
          prompt_tokens: cs.reduce((a, c) => a + c.prompt_tokens, 0),
          completion_tokens: cs.reduce((a, c) => a + c.completion_tokens, 0),
          total_tokens: sum(cs).total_tokens,
        },
  );
  return { bucket_size_seconds: size, dimension: "agent-name", series: rows.length ? [{ dimension_value: "strut-agent", points }] : [] };
}

/** A custom provider bifrost holds (`POST /api/providers`). */
export interface FakeCustomProvider {
  base_url: string;
  allow_private_network?: boolean;
  base_provider_type: string;
}

export interface FakeState {
  /** Each provider's keys. Starts as the baked config.json's one empty env slot per provider. */
  providerKeys: Map<string, FakeKey[]>;
  /** The custom providers an admin added, by name. Their keys are in providerKeys. */
  customProviders: Map<string, FakeCustomProvider>;
  /** The gateway's runtime price table (`PUT /_plugin/pricing`). Null: the gateway predates the route (404). */
  pricing: Record<string, unknown> | null;
  /** The gateway's client config (`GET /api/config`'s `client_config`). */
  clientConfig: Record<string, unknown>;
  /** strut's deployment secret store (`PUT /secrets/:name`). */
  deploymentSecrets: Map<string, string>;
  customers: Array<{
    id: string;
    name: string;
    created_at: string;
    budget?: { max_limit: number; reset_duration: string; last_reset?: string };
  }>;
  /** Model calls the gateway logged: what its spend rollups and each customer's budget usage sum. `user_id` is the actor (= customer name). */
  calls: FakeCall[];
  vks: Array<{ id: string; name: string; value: string; customer_id: string; created_at: string; provider_configs: unknown[] }>;
  trust: Map<string, { org_id: string; pubkey: string; issuer_url: string; revocation_poll_seconds: number }>;
  realmId: string;
  agents: unknown[];
  delegations: Map<string, { actor: string; exp: string; delegationId: string; apiKey: string; baseUrl: string }>;
  secrets: Map<string, string>;
  /** `GET /apps`, in strut's order (by name). Starts as SEEDED_APPS. */
  apps: FakeApp[];
  /** Each app's versions, releases and warnings, by name. */
  appRecords: Map<string, FakeAppRecord>;
  /** Set to make the next `PUT /apps/:name/active { release }` a 409 with this message. */
  refuseRelease: string | null;
  /** `GET /brand`'s record, as strut keeps it (normalized). */
  brand: StrutBrand;
  /** Sign-in tickets strut minted: who each signs in, as what, until when, whether spent. */
  tickets: Map<string, { actor: string; role: "admin" | "member"; exp: number; used: boolean }>;
  /** Set to make strut's /health report a drain. */
  drain: { since: string; reason: string; idle: boolean } | null;
  requests: string[];
  /** Flip to simulate an outage of one service. */
  down: { bifrost: boolean; strut: boolean; neo4j: boolean };
}

export async function startFakeStack(opts: FakeStackOptions = {}, port = 0) {
  const token = opts.token ?? "fake-shared-token";
  const adminUser = opts.adminUser ?? "admin";
  const adminPass = opts.adminPass ?? "fake-admin-pass";
  const providers = opts.providers ?? ["anthropic", "openai"];
  const basic = `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}`;

  const state: FakeState = {
    providerKeys: new Map(
      providers.map((p) => [p, [{ id: randomUUID(), name: `${p}-key-1`, value: { value: "", ref: `env.${p.toUpperCase()}_API_KEY`, type: "env" as const }, models: ["*"], weight: 1 }]]),
    ),
    customProviders: new Map(),
    pricing: {},
    clientConfig: { log_retention_days: 365, enable_logging: true, disable_content_logging: false, drop_excess_requests: false },
    deploymentSecrets: new Map(),
    customers: [],
    calls: [],
    vks: [],
    trust: new Map(),
    realmId: "",
    agents: [],
    delegations: new Map(),
    secrets: new Map(),
    apps: SEEDED_APPS.map((a) => ({ ...a })),
    appRecords: new Map(SEEDED_APPS.map((a) => [a.name, seededRecord()])),
    refuseRelease: null,
    brand: {},
    tickets: new Map(),
    drain: null,
    requests: [],
    down: { bifrost: false, strut: false, neo4j: false },
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    state.requests.push(`${req.method} ${url.pathname}`);
    const body = await readJson(req);
    try {
      if (url.pathname.startsWith("/bifrost/")) {
        if (state.down.bifrost) return send(res, 503, { error: "down" });
        return bifrost(req, res, url.pathname.slice("/bifrost".length), url, body);
      }
      if (url.pathname.startsWith("/strut/")) {
        if (state.down.strut) return send(res, 503, { error: "down" });
        return strut(req, res, url.pathname.slice("/strut".length), url, body);
      }
      if (url.pathname === "/neo4j/" || url.pathname === "/neo4j") {
        if (state.down.neo4j) return send(res, 503, { error: "down" });
        return send(res, 200, { bolt_direct: "bolt://neo4j:7687", neo4j_version: "5.26.32", neo4j_edition: "community" });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  function bifrost(req: IncomingMessage, res: ServerResponse, path: string, url: URL, body: any) {
    const m = req.method;
    if (path.startsWith("/_plugin/")) {
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, "unauthorized");
      if (path === "/_plugin/admin-credentials") return send(res, 200, { admin_username: adminUser, admin_password: adminPass });
      if (path === "/_plugin/trust/status" && m === "GET") {
        return send(res, 200, {
          claimed: state.trust.size > 0,
          org_count: state.trust.size,
          orgs: [...state.trust.keys()],
          seed_source: state.trust.size ? "api" : "",
          last_modified: new Date().toISOString(),
          ...(state.realmId ? { realm_id: state.realmId } : {}),
        });
      }
      if (path === "/_plugin/trust/realm_id" && m === "PUT") {
        state.realmId = body.realm_id;
        return send(res, 200, { ok: true, realm_id: state.realmId });
      }
      if (path === "/_plugin/trust" && m === "POST") {
        if (!/^0[23][0-9a-f]{64}$/.test(body.pubkey)) return send(res, 400, "bad pubkey");
        state.trust.set(body.org_id, body);
        return send(res, 200, { ok: true, org_id: body.org_id });
      }
      if (path.startsWith("/_plugin/trust/") && m === "GET") {
        const row = state.trust.get(decodeURIComponent(path.slice("/_plugin/trust/".length)));
        return row ? send(res, 200, row) : send(res, 404, "not found");
      }
      if (path === "/_plugin/pricing") {
        if (state.pricing === null) return send(res, 404, "not found");
        if (m === "PUT") {
          if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "body must be an object" });
          state.pricing = body;
          return send(res, 200, { ok: true, rows: Object.keys(body).length });
        }
        return send(res, 200, state.pricing);
      }
      if (m === "GET" && (path.startsWith("/_plugin/spend/") || path.startsWith("/_plugin/histogram/"))) {
        return send(res, 200, rollup(state.calls, path, url));
      }
      if (path === "/_plugin/agents" && m === "POST") {
        state.agents = body.agents;
        return send(res, 200, { written: { agents: body.agents.length, prompts: 0, tools: 0, skills: 0 } });
      }
      return send(res, 404, "not found");
    }
    if (path.startsWith("/api/")) {
      if (req.headers.authorization !== basic) return send(res, 401, { error: "unauthorized" });
      const listed = () => [
        ...providers.map((name) => ({ name })),
        ...[...state.customProviders].map(([name, c]) => ({
          name,
          network_config: { base_url: c.base_url, ...(c.allow_private_network ? { allow_private_network: true } : {}) },
          custom_provider_config: { base_provider_type: c.base_provider_type },
        })),
      ];
      if (path === "/api/providers" && m === "GET") return send(res, 200, { providers: listed(), total: listed().length });
      if (path === "/api/providers" && m === "POST") {
        // Bifrost's create payload has no `keys`: a key sent here is dropped, without an error.
        const name = body?.provider;
        const cpc = body?.custom_provider_config;
        if (!name) return send(res, 400, { error: "Missing provider" });
        if (cpc && providers.concat(["gemini", "mistral", "groq"]).includes(name)) return send(res, 400, { error: "Custom provider cannot be same as a standard provider" });
        if (!cpc?.base_provider_type) return send(res, 400, { error: "BaseProviderType is required when CustomProviderConfig is provided" });
        const url = body?.network_config?.base_url ?? "";
        const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
        if (!host) return send(res, 400, { error: "Invalid base URL" });
        if (!host.includes(".") && !body.network_config.allow_private_network) return send(res, 400, { error: "Invalid base URL: private network address" });
        if (state.customProviders.has(name) || state.providerKeys.has(name)) return send(res, 409, { error: `Provider ${name} already exists` });
        state.customProviders.set(name, { base_url: url, allow_private_network: body.network_config.allow_private_network, base_provider_type: cpc.base_provider_type });
        state.providerKeys.set(name, []);
        return send(res, 200, { name });
      }
      const one = path.match(/^\/api\/providers\/([^/]+)$/);
      if (one) {
        const name = decodeURIComponent(one[1]!);
        const c = state.customProviders.get(name);
        if (!c && !providers.includes(name)) return send(res, 404, { error: `Provider not found: ${name}` });
        if (m === "DELETE") {
          state.customProviders.delete(name);
          state.providerKeys.delete(name);
          return send(res, 200, { message: "deleted" });
        }
        return send(res, 200, listed().find((p) => p.name === name));
      }
      const keys = path.match(/^\/api\/providers\/([^/]+)\/keys(?:\/([^/]+))?(\/refresh-models)?$/);
      if (keys) return providerKeyRoute(res, m ?? "GET", decodeURIComponent(keys[1]!), keys[2] ? decodeURIComponent(keys[2]) : undefined, !!keys[3], body);
      if (path === "/api/config" && m === "GET") return send(res, 200, { client_config: state.clientConfig, framework_config: {}, auth_config: {} });
      if (path === "/api/config" && m === "PUT") {
        const cc = body?.client_config;
        if (!cc || typeof cc !== "object") return send(res, 400, { error: "Invalid request payload" });
        if (!(cc.log_retention_days >= 1)) return send(res, 400, { error: "log_retention_days must be at least 1" });
        state.clientConfig = cc;
        return send(res, 200, { status: "success" });
      }
      if (path === "/api/governance/customers" && m === "GET") {
        const q = url.searchParams.get("search") ?? "";
        // Reads return `budgets[]`, with what each budget has counted: its customer's calls since its last reset.
        const customers = state.customers
          .filter((c) => c.name.includes(q))
          .map(({ budget, ...c }) => ({
            ...c,
            budgets: budget
              ? [
                  {
                    ...budget,
                    current_usage: state.calls
                      .filter((k) => k.user_id === c.name && k.ts >= (budget.last_reset ?? ""))
                      .reduce((a, k) => a + k.cost, 0),
                  },
                ]
              : [],
          }));
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const page = customers.slice(offset, offset + limit);
        return send(res, 200, { customers: page, count: page.length, total_count: customers.length, limit, offset });
      }

      if (path.startsWith("/api/governance/customers/") && m === "PUT") {
        const customer = state.customers.find((c) => c.id === decodeURIComponent(path.slice("/api/governance/customers/".length)));
        if (!customer) return send(res, 404, { error: "customer not found" });
        // bifrost keeps the budget's id, its usage and its last reset.
        if (body.budget) customer.budget = { ...customer.budget, ...body.budget };
        return send(res, 200, { message: "updated", customer });
      }
      if (path === "/api/governance/customers" && m === "POST") {
        if (state.customers.some((c) => c.name === body.name)) return send(res, 400, { error: "duplicate key value" });
        const customer = { id: randomUUID(), name: body.name, created_at: new Date().toISOString(), budget: body.budget, rate_limit: body.rate_limit };
        state.customers.push(customer);
        return send(res, 200, { message: "created", customer });
      }
      if (path === "/api/governance/virtual-keys" && m === "GET") {
        const q = url.searchParams.get("search") ?? "";
        const cid = url.searchParams.get("customer_id");
        const virtual_keys = state.vks.filter((v) => v.name.includes(q) && (!cid || v.customer_id === cid));
        return send(res, 200, { virtual_keys, count: virtual_keys.length, total_count: virtual_keys.length, limit: 50, offset: 0 });
      }
      if (path === "/api/governance/virtual-keys" && m === "POST") {
        for (const pc of body.provider_configs) {
          if (!providers.includes(pc.provider) && !state.customProviders.has(pc.provider)) return send(res, 400, { error: `provider ${pc.provider} not configured` });
          if (JSON.stringify(pc.key_ids) !== '["*"]') return send(res, 400, { error: "key_ids must be [\"*\"] here" });
        }
        const vk = {
          id: randomUUID(),
          name: body.name,
          value: `sk-bf-${randomUUID()}`,
          customer_id: body.customer_id,
          created_at: new Date().toISOString(),
          provider_configs: body.provider_configs.map((pc: object, i: number) => ({ id: i + 1, ...pc, allow_all_keys: true })),
        };
        state.vks.push(vk);
        return send(res, 200, { message: "created", virtual_key: vk });
      }
      const vkMatch = path.match(/^\/api\/governance\/virtual-keys\/([^/]+)$/);
      if (vkMatch) {
        const vk = state.vks.find((v) => v.id === decodeURIComponent(vkMatch[1]!));
        if (!vk) return send(res, 404, { error: "not found" });
        if (m === "PUT") {
          // Bifrost replaces the set; a config sent without an id is a new one and gets one.
          let next = Math.max(0, ...vk.provider_configs.map((pc: any) => pc.id ?? 0)) + 1;
          vk.provider_configs = body.provider_configs.map((pc: any) => ({ ...pc, id: pc.id ?? next++, allow_all_keys: JSON.stringify(pc.key_ids) === '["*"]' }));
        }
        return send(res, 200, { virtual_key: vk });
      }
    }
    send(res, 404, { error: "not found" });
  }

  /** `/api/providers/:p/keys[/:id[/refresh-models]]`. A key "works" when its value starts with `sk-good`. */
  function providerKeyRoute(res: ServerResponse, m: string, provider: string, id: string | undefined, refresh: boolean, body: any) {
    const list = state.providerKeys.get(provider);
    if (!list) return send(res, 404, { error: `Provider not found: ${provider}` });
    // Bifrost answers `keys: null` for a provider with none.
    if (!id && m === "GET") return send(res, 200, { keys: list.length ? list.map(redactKey) : null, total: list.length });
    if (!id && m === "POST") {
      if (typeof body?.value !== "string" || !body.value) return send(res, 400, { error: "Key value must not be empty" });
      if ([...state.providerKeys.values()].flat().some((k) => k.name === body.name)) {
        return send(res, 409, { error: "API key names must be unique across providers. Choose a different name" });
      }
      const key: FakeKey = { id: randomUUID(), name: body.name, value: body.value, models: body.models ?? [], weight: body.weight ?? 1 };
      list.push(key);
      return send(res, 200, redactKey(key));
    }
    const key = list.find((k) => k.id === id);
    if (!key) return send(res, 404, { error: "Provider key not found" });
    if (refresh && m === "POST") {
      const value = typeof key.value === "string" ? key.value : key.value.value;
      Object.assign(
        key,
        value.startsWith("sk-good")
          ? { status: "success", description: "" }
          : { status: "list_models_failed", description: 'provider API error: {"code":"invalid-argument","error":"Incorrect API key provided."}' },
      );
      return send(res, 200, redactKey(key));
    }
    if (m === "GET") return send(res, 200, redactKey(key));
    if (m === "PUT") {
      // Bifrost replaces the key with the body (mergeUpdatedKey): fields left out are lost.
      if (typeof body?.value !== "string" || !body.value) return send(res, 400, { error: "Key value must not be empty" });
      Object.assign(key, { name: body.name, value: body.value, models: body.models ?? [], weight: body.weight ?? 0, status: undefined, description: undefined });
      return send(res, 200, redactKey(key));
    }
    if (m === "DELETE") {
      list.splice(list.indexOf(key), 1);
      return send(res, 200, { message: "deleted" });
    }
    send(res, 404, { error: "not found" });
  }

  /** Strut with STRUT_API_KEY = the shared token and STRUT_MOTHERSHIP=1. */
  function strut(req: IncomingMessage, res: ServerResponse, path: string, url: URL, body: any) {
    const m = req.method;
    const keyed = req.headers.authorization === `Bearer ${token}`;
    // The keyless probe gets `{ ok }` and nothing else.
    if (path === "/health" && m === "GET") {
      if (!keyed) return send(res, 200, { ok: true });
      return send(res, 200, { ok: true, dataDir: "/data/workspace", stepCount: 42, workspace: { backend: "neo4j" }, ...(state.drain ? { drain: state.drain } : {}) });
    }
    // The UI is served without the key; a ticket signs the page in, once.
    if (path === "/" && m === "GET") {
      const t = state.tickets.get(url.searchParams.get("ticket") ?? "");
      if (!t || t.used || t.exp <= Date.now()) return html(res, embedPage(undefined, url.searchParams), 401);
      t.used = true;
      return html(res, embedPage(t, url.searchParams, state.apps));
    }
    if (!keyed) return send(res, 401, { error: "unauthorized" });
    if (path === "/auth/ticket" && m === "POST") {
      const actor = typeof body?.actor === "string" ? body.actor.trim() : "";
      if (!actor || actor.length > 120) return send(res, 400, { error: "actor is required" });
      // No role is a member; a role that is neither is refused (strut plans/member-rights.md).
      const role = body?.role ?? "member";
      if (role !== "admin" && role !== "member") return send(res, 400, { error: 'role must be "admin" or "member"' });
      const ticket = `strut-ticket.${randomBytes(16).toString("base64url")}`;
      const exp = Date.now() + 60_000;
      state.tickets.set(ticket, { actor, role, exp, used: false });
      return send(res, 200, { ticket, expiresAt: exp });
    }
    if (path === "/apps" && m === "GET") {
      const listed = [...state.apps].sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
        const warnings = state.appRecords.get(a.name)?.warnings.filter((w) => w.version === a.activeVersion).length ?? 0;
        return warnings ? { ...a, warnings } : a;
      });
      return send(res, 200, { apps: listed });
    }
    if (path === "/brand" && m === "GET") return send(res, 200, { brand: state.brand, styles: brandStyles(state.brand) });
    if (path === "/brand" && m === "PUT") {
      const problem = brandProblem(body);
      if (problem) return send(res, 400, { error: problem });
      state.brand = normalizeBrand(body);
      return send(res, 200, { brand: state.brand, styles: brandStyles(state.brand) });
    }
    const one = path.match(/^\/apps\/([^/]+)\/(versions|usage|active|pin)$/);
    if (one) return appRoute(req, res, decodeURIComponent(one[1]!), one[2]!, body);
    if (path === "/llm/delegations" && m === "GET") {
      return send(res, 200, [...state.delegations.values()].map(({ actor, exp, delegationId }) => ({ actor, exp, delegationId })));
    }
    const del = path.match(/^\/llm\/delegations\/([^/]+)$/);
    if (del) {
      const who = decodeURIComponent(del[1]!);
      if (m === "DELETE") return state.delegations.delete(who) ? send(res, 200, { ok: true, actor: who }) : send(res, 404, { error: `no delegation for ${who}` });
      if (m === "PUT") {
        if (!/^https?:\/\//.test(body.baseUrl ?? "")) return send(res, 400, { error: "baseUrl (http(s) URL) is required" });
        if (!body.apiKey) return send(res, 400, { error: "apiKey (string) is required" });
        let shape;
        try {
          shape = checkDelegationShape(body.macaroon);
          const mac = decodeMacaroon(body.macaroon);
          const trusted = state.trust.get(mac.org_id);
          if (!trusted) throw new Error(`org ${mac.org_id} is not in the trust registry`);
          if (mac.user_authorization.user_id !== who) throw new Error("macaroon user_id is not the actor");
          verify(mac, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: trusted.pubkey } }, new Date());
        } catch (err) {
          return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        state.delegations.set(who, { actor: who, exp: shape.exp, delegationId: shape.delegationId, apiKey: body.apiKey, baseUrl: body.baseUrl });
        return send(res, 200, { actor: who, exp: shape.exp, delegationId: shape.delegationId });
      }
    }
    if (path === "/llm/models" && m === "GET") return send(res, 200, FAKE_MODEL_CATALOG);
    const setting = path.match(/^\/secrets\/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (setting && m === "PUT") {
      if (typeof body?.value !== "string" || !body.value) return send(res, 400, { error: "value (non-empty string) is required" });
      state.deploymentSecrets.set(setting[1]!, body.value);
      return send(res, 200, { ok: true, name: setting[1] });
    }
    const sec = path.match(/^\/actors\/([^/]+)\/secrets\/([^/]+)$/);
    if (sec && m === "PUT") {
      state.secrets.set(`${decodeURIComponent(sec[1]!)}/${sec[2]}`, body.value);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  }

  /** One app's versions, usage, what is live and the pin (strut §14.5, §14.6). */
  function appRoute(req: IncomingMessage, res: ServerResponse, name: string, what: string, body: any) {
    const m = req.method;
    const app = state.apps.find((a) => a.name === name);
    const rec = state.appRecords.get(name);
    if (!app || !rec) return send(res, 404, { error: `App "${name}" not found` });
    const actor = typeof req.headers["x-strut-actor"] === "string" ? req.headers["x-strut-actor"] : undefined;
    const seeded = rec.versions[app.activeVersion]?.source === "seed";
    const release = (version: string) => {
      const r = { id: `r${rec.releases.length + 1}`, version, createdAt: new Date().toISOString(), ...(actor ? { by: actor } : {}) };
      rec.releases.push(r);
      app.activeVersion = version;
      app.live = r.id;
      return r;
    };
    const cannotHold = () => send(res, 409, { error: `${name} is seeded by strut and always runs its committed version — it cannot be held` });

    if (what === "versions" && m === "GET") {
      return send(res, 200, {
        name,
        active: app.activeVersion,
        versions: rec.versions,
        ...(app.pinned ? { pinned: true } : {}),
        live: app.live ?? "latest",
        releases: rec.releases.map((r) => ({ ...r, lock: { workflows: {}, steps: {} } })),
        behind: [],
      });
    }
    if (what === "usage" && m === "GET") {
      const zero = { calls: 0, errors: 0, bytes: 0, ms: 0 };
      return send(res, 200, { app: name, hour: zero, day: zero, minutes: [], types: [], warnings: rec.warnings });
    }
    if (what === "active" && m === "PUT") {
      const version = typeof body?.version === "string" && body.version ? body.version : undefined;
      const rel = typeof body?.release === "string" && body.release ? body.release : undefined;
      if (!version === !rel) return send(res, 400, { error: "one of version or release is required" });
      if (seeded) return cannotHold();
      if (version === "latest") {
        const newest = Object.keys(rec.versions).sort((a, b) => versionNumber(b) - versionNumber(a))[0]!;
        app.activeVersion = newest;
        delete app.live;
      } else if (version) {
        if (!rec.versions[version]) return send(res, 404, { error: `version ${version} not found` });
        release(version);
      } else {
        const r = rec.releases.find((x) => x.id === rel);
        if (!r) return send(res, 404, { error: `release ${rel} not found` });
        if (state.refuseRelease) {
          const error = state.refuseRelease;
          state.refuseRelease = null;
          return send(res, 409, { error });
        }
        app.activeVersion = r.version;
        app.live = r.id;
      }
      return send(res, 200, { ok: true, name, active: app.activeVersion, live: app.live ?? "latest" });
    }
    if (what === "pin" && m === "PUT") {
      if (typeof body?.pinned !== "boolean") return send(res, 400, { error: "pinned is required: true or false" });
      let made;
      if (body.pinned) {
        // Pinning holds an app that follows latest, at the version it shows; a seeded one is pinned and still follows.
        if (!app.live && !seeded) made = release(app.activeVersion);
        app.pinned = true;
      } else delete app.pinned;
      return send(res, 200, { ok: true, name, pinned: body.pinned, live: app.live ?? "latest", ...(made ? { release: made } : {}) });
    }
    send(res, 404, { error: "not found" });
  }

  /** Publish the next version of an app, as `POST /apps` would: live at once while it follows latest, a draft while held. */
  function publish(name: string, title = name): string {
    let app = state.apps.find((a) => a.name === name);
    if (!app) {
      app = { name, activeVersion: "", versions: [], title, grants: grants() };
      state.apps.push(app);
      state.appRecords.set(name, { versions: {}, releases: [], warnings: [] });
    }
    const rec = state.appRecords.get(name)!;
    const version = `v${app.versions.length + 1}`;
    rec.versions[version] = { createdAt: new Date().toISOString() };
    app.versions.push(version);
    if (!app.live) app.activeVersion = version;
    return version;
  }

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${actual}`;
  return {
    state,
    base,
    bifrostUrl: `${base}/bifrost`,
    strutUrl: `${base}/strut`,
    neo4jUrl: `${base}/neo4j`,
    token,
    adminUser,
    adminPass,
    publish,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeStack = Awaited<ReturnType<typeof startFakeStack>>;

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(text);
}

function html(res: ServerResponse, body: string, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

/** Strut's UI showing one app alone (`?app=<name>&solo=1`), as the frame opens it. */
function embedPage(who: { actor: string; role: string } | undefined, q: URLSearchParams, apps: FakeApp[] = []): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const name = q.get("app") ?? "";
  const app = apps.find((a) => a.name === name);
  const body = !who
    ? "<p>This sign-in link has expired. Reload the page from the app you opened it in to sign in again.</p>"
    : !app
      ? `<p>No app <code>${esc(name || "(none)")}</code>.</p>`
      : `<h1 style="font-weight:600;font-size:18px">${esc(app.title)}</h1>
<p>App: <code>${esc(app.name)}</code>${q.get("solo") === "1" ? " alone" : ""}, input <code>${esc(q.get("input") ?? "(none)")}</code>, theme <code>${esc(q.get("theme") ?? "dark")}</code></p>
<p>Signed in as actor: <code>${esc(who.actor)}</code>, role <code>${esc(who.role)}</code></p>
<p>This page stands in for strut's app host. It was opened with a one-use sign-in ticket, not the shared token.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>Strut (fake)</title>
<style>body{font:15px system-ui;margin:0;padding:32px;color:#333;background:#fafafa}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
${body}`;
}
