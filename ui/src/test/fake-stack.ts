/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are arbitrary JSON in a test fake */
/**
 * A fake of the stadeum stack on one port, for tests and local runs:
 *   /bifrost  — gateway: /_plugin/* (Bearer) and /api/* (Basic): customers,
 *               virtual keys, each provider's keys and their check, the
 *               client config (bifrost transports/v2.2.2 handlers)
 *   /strut    — strut: /health, /apps (the list, each app's versions,
 *               usage, what is live and the pin), /brand, /auth/ticket and
 *               the app page a ticket opens (it posts `strut:ready` to its
 *               host, as strut's does), /llm/delegations, /llm/models,
 *               /secrets[/:name], /actors/:actor/secrets, /packages (what is
 *               installed, search, install — with `wait: false` a record
 *               that walks strut's phases over `state.installMs`, read at
 *               /packages/installs[/:id] — uninstall, the indexes followed,
 *               over the indexes in `state.indexes`), /voice/calls (strut
 *               specs/API.md): a call's answer carries a real LiveKit token
 *               for `livekit` (default `livekit-server --dev`), but no agent
 *               joins the room, unless the call is forwarded to a voice
 *               service, as strut does
 *   /neo4j    — HTTP discovery
 * Wire shapes follow docs/mothership-spec.md. The delegation PUT runs
 * Strut's own shape check and verifies the macaroon against the org key
 * the trust registry holds, like the real gateway would.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeMacaroon, verify } from "gatekey";

import { brandStyles } from "@/lib/brand";
import type { StrutBrand } from "@/lib/strut/client";
import { brandProblem, normalizeBrand } from "./strut-brand";
import { fakeIndexes, indexSubscriptionProblem, matches, type FakeIndex, type FakeRelease } from "./strut-packages";
import { checkDelegationShape } from "./strut-shape";

export interface FakeStackOptions {
  token?: string;
  adminUser?: string;
  adminPass?: string;
  providers?: string[];
  /** The LiveKit server `/voice/calls` mints tokens for. Default: `livekit-server --dev` on this machine. */
  livekit?: FakeLivekit;
}

export interface FakeLivekit {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** `livekit-server --dev`'s address and keys. */
export const DEV_LIVEKIT: FakeLivekit = { url: "ws://127.0.0.1:7880", apiKey: "devkey", apiSecret: "secret" };

/** The voices strut's `/audio/speak` has, as the voice service checks a call's `voice` against them. */
const FAKE_VOICES = ["af_heart", "am_michael", "bf_emma", "bm_george"];

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
  /** An admin's app alone (§14.14): listed to full scope, the key; refused to a member's session. */
  admin?: true;
}

const grants = (workflows: string[] = [], steps: string[] = []) => ({ workflows, steps, sqlite: false, automations: [] });

/** What strut seeds on every server: its component library, Jamie and Earnings. */
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
  {
    name: "strut/earnings",
    activeVersion: "v1",
    versions: ["v1"],
    title: "Earnings",
    description: "The wallet, and what paid runs earned.",
    icon: "wallet",
    grants: grants([], ["earnings/read", "earnings/wallet"]),
    publisher: "strut",
    admin: true,
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
  /** Each built-in's network settings (`GET`/`PUT /api/providers/:p`): no `base_url` until one is set. */
  providerNetwork: Map<string, Record<string, unknown>>;
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
  /** The indexes strut can reach, by key: where each card is served and what it lists. Following one by another key or address reads no card. */
  indexes: Map<string, FakeIndex>;
  /** `GET /packages/indexes`: the indexes strut follows, in order. Starts empty, as strut's default does. */
  followed: Array<{ id: string; key: string; urls: string[]; label?: string }>;
  /** `GET /packages`: what is installed, with the release it came from. */
  installed: Array<{ release: FakeRelease; door: "install" | "distro"; actor?: string; modified: string[] }>;
  /** Set to refuse the next package install or uninstall with this status and `error`. */
  refusePackage: { status: number; error: string } | null;
  /** How long a package install takes, in ms: its record walks strut's phases over that time. 0: ended at the first read. */
  installMs: number;
  /** Every install asked for, oldest first: `GET /packages/installs[/:id]` reads them as they stand now. */
  installs: FakeInstall[];
  /** Set to answer an install as a strut from before `wait` (stakwork/strut#588): 201 once done, whatever `wait` says. */
  installWaits: boolean;
  /** Sign-in tickets strut minted: who each signs in, as what, until when, whether spent. */
  tickets: Map<string, { actor: string; role: "admin" | "member"; exp: number; used: boolean }>;
  /** Set to make strut's /health report a drain. */
  drain: { since: string; reason: string; idle: boolean } | null;
  requests: string[];
  /** Flip to simulate an outage of one service. */
  down: { bifrost: boolean; strut: boolean; neo4j: boolean };
  /** How long after it loads the framed app page posts `strut:ready` (ms), as strut's does once the app has started: a slow app, to a host. */
  readyAfter: number;
  /**
   * `POST /voice/calls`: the LiveKit server its tokens are for (null: strut
   * has no voice service, a 503), a refusal to give instead (a 402 with
   * `{ error, balance, minimum }`, say), a voice service to hand calls to
   * instead, as strut does with STRUT_VOICE_URL and STRUT_VOICE_TOKEN, and
   * each call answered here: whose and which room, never its key.
   */
  voice: {
    livekit: FakeLivekit | null;
    refuse: { status: number; body: unknown } | null;
    forward: { url: string; token: string } | null;
    calls: Array<{ actor: string; room: string }>;
  };
}

/** One phase of a fake install, as strut reports it. */
interface FakeStep {
  phase: string;
  package?: string;
  total?: number;
}

/** What a fake install will do: the 201's body, or the refusal; its phases; its writes. */
type FakePlan = ({ status: 201; result: unknown; error?: never } | { status: number; error: string; result?: never }) & {
  steps: FakeStep[];
  commit?: () => void;
};

/** A fake install's record: when it started and how long it takes. */
export interface FakeInstall {
  id: string;
  ref: string;
  actor?: string;
  startedAt: number;
  ms: number;
  steps: FakeStep[];
  plan: FakePlan;
  ended: boolean;
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
    providerNetwork: new Map(
      providers.map((p) => [p, { default_request_timeout_in_seconds: 30, max_retries: 0, retry_backoff_initial: 500, retry_backoff_max: 5000 }]),
    ),
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
    indexes: fakeIndexes(),
    followed: [],
    installed: [],
    refusePackage: null,
    installMs: 0,
    installs: [],
    installWaits: false,
    tickets: new Map(),
    drain: null,
    requests: [],
    down: { bifrost: false, strut: false, neo4j: false },
    readyAfter: 0,
    voice: { livekit: opts.livekit ?? DEV_LIVEKIT, refuse: null, forward: null, calls: [] },
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
        const net = state.providerNetwork.get(name);
        if (m === "PUT" && net) {
          // Bifrost replaces the network settings with the body's, and refuses a private address without leave.
          const nc = body?.network_config;
          if (!nc || typeof nc !== "object") return send(res, 400, { error: "Invalid request payload" });
          const host = nc.base_url ? (() => { try { return new URL(nc.base_url).hostname; } catch { return ""; } })() : ".";
          if (!host) return send(res, 400, { error: "Invalid base URL" });
          if (!host.includes(".") && !nc.allow_private_network) return send(res, 400, { error: "Invalid base URL: private network address" });
          state.providerNetwork.set(name, nc);
          return send(res, 200, { name, network_config: nc });
        }
        if (net) return send(res, 200, { name, network_config: net, concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 } });
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
      if (!t || t.used || t.exp <= Date.now()) return html(res, embedPage(undefined, url.searchParams, [], state.readyAfter), 401);
      t.used = true;
      return html(res, embedPage(t, url.searchParams, state.apps, state.readyAfter));
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
    if (path === "/voice/calls" && m === "POST") return voiceCall(req, res, body);
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
    if (path === "/secrets" && m === "GET") {
      return send(res, 200, { secrets: [...state.deploymentSecrets.keys()].sort().map((name) => ({ name, createdAt: "2026-11-05T12:00:00.000Z", updatedAt: "2026-11-05T12:00:00.000Z" })) });
    }
    if (path === "/packages" || path.startsWith("/packages/")) return packagesRoute(req, res, path, url, body);
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

  /**
   * `POST /voice/calls` (strut §15.2) with the voice service's checks
   * (sphinx-voice `calls-route.ts`): a fresh room, two random identities,
   * the person's token for the room, `encrypted: true` for a call with a
   * key. The real service answers once its agent is in the room; here none
   * ever joins.
   */
  function voiceCall(req: IncomingMessage, res: ServerResponse, body: any) {
    const actor = typeof req.headers["x-strut-actor"] === "string" ? req.headers["x-strut-actor"] : "";
    if (!actor) return send(res, 403, { error: "a call runs as a person: x-strut-actor is required with the deployment key" });
    if (state.voice.refuse) return send(res, state.voice.refuse.status, state.voice.refuse.body);
    const forward = state.voice.forward;
    if (forward) {
      // As strut does: the body unchanged, the person as x-strut-actor, the shared secret as the bearer, the answer as it came.
      void fetch(`${forward.url}/calls`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-strut-actor": actor, authorization: `Bearer ${forward.token}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000),
      })
        .then(async (r) => send(res, r.status, await r.json().catch(() => ({}))))
        .catch(() => send(res, 503, { error: "the voice service is not answering" }));
      return;
    }
    const lk = state.voice.livekit;
    if (!lk) return send(res, 503, { error: "no voice service is configured (STRUT_VOICE_URL)" });
    // An empty body is `{}`, as the voice service reads it.
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body))) return send(res, 400, { error: "the body must be a JSON object" });
    const { key, voice, artifacts } = body ?? {};
    if (artifacts !== undefined && typeof artifacts !== "boolean") return send(res, 400, { error: "artifacts must be a boolean" });
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(key) || Buffer.from(key, "base64").length !== 32)) {
      return send(res, 400, { error: "key must be 32 bytes, as base64" });
    }
    if (voice !== undefined && !FAKE_VOICES.includes(voice)) return send(res, 400, { error: `unknown voice ${JSON.stringify(voice)}` });
    const hex = () => randomBytes(16).toString("hex");
    const room = `sphinx.call.voice.${hex()}`;
    const identity = hex();
    state.voice.calls.push({ actor, room });
    return send(res, 200, {
      url: lk.url,
      room,
      token: livekitToken(lk, identity, room),
      identity,
      agent: hex(),
      encrypted: key !== undefined,
      voice: voice ?? "af_heart",
    });
  }

  /** A followed index's card, when strut can read it: the key and an address must both be the index's. */
  function cardOf(sub: { key: string; urls: string[] }) {
    const ix = state.indexes.get(sub.key);
    return ix && sub.urls.some((u) => ix.urls.includes(u)) ? ix : undefined;
  }

  /**
   * What an install by name will do, decided now as strut's resolveName and
   * install would: the refusal (as a failed record, under `wait: false`) or
   * the result, with the writes to make once it is done.
   */
  function planInstall(ref: string, body: any, actor: string | undefined): FakePlan {
    const no = (status: number, error: string): FakePlan => ({ status, error, steps: [] });
    if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(ref)) return no(400, `package_source_unsupported: the fake installs names only, not ${ref}`);
    // As strut's resolveName: the index named first, then none followed at all.
    const subs = body.index ? state.followed.filter((s) => s.id === body.index) : state.followed;
    if (body.index && !subs.length) return no(404, `package_index_unknown: this strut server follows no index "${body.index}"`);
    if (!subs.length) {
      return no(400, `package_source_invalid: ${ref} is a name, and this strut server follows no index to look it up in — install by pk:<key>/${ref} with url, or follow one (PUT /packages/indexes/:id)`);
    }
    const [publisher] = ref.split("/");
    const card = subs.map(cardOf).find((c) => c?.releases.some((r) => r.publisher === publisher));
    if (!card) return no(404, `package_not_listed: no index this strut server follows lists the publisher ${publisher}`);
    const release = card.releases.find((r) => r.package === ref);
    if (!release) return no(404, `package_not_found: ${publisher}'s public catalog has no package ${ref}`);
    if (body.digest && body.digest !== release.digest) return no(404, `package_not_published: ${ref} has no release ${body.digest}`);
    const here = state.installed.find((p) => p.release.package === ref);
    if (here?.door === "distro") return no(409, `package_distro_owned: ${ref} was installed by the distro: only it updates or removes it`);
    const r = state.refusePackage;
    state.refusePackage = null;
    if (r) return no(r.status, r.error);
    if (here && here.release.digest !== release.digest) {
      return no(409, `package_update_not_built: ${ref} is installed here at ${here.release.digest}; updating it to ${release.digest} asks first, which is not built yet`);
    }
    const secrets = release.requires?.secrets ?? release.detail?.secrets ?? [];
    const kinds = (k: string) => release.items.filter((i) => i.kind === k && !i.helper).length;
    const concepts = Math.max(kinds("concept"), release.detail?.concepts ?? 0);
    return {
      status: 201,
      result: {
        package: ref,
        digest: release.digest,
        packages: [
          {
            package: ref,
            version: release.version,
            digest: release.digest,
            source: { ref: `pk:${release.key}/${ref}`, url: release.urls[0] },
            status: here ? "present" : "installed",
            items: release.items.map((i) => ({ kind: i.kind, name: i.kind === "concept" ? i.name : `${ref}/${i.name}`, status: here ? "present" : "installed" })),
          },
        ],
        missing: { secrets: secrets.filter((s) => !state.deploymentSecrets.has(s)).sort(), binaries: [], runtimes: [] },
        warnings: [],
      },
      // Strut's phases, each with the counts it reports.
      steps: [
        { phase: "checking" },
        ...(kinds("step") ? [{ phase: "steps", package: ref, total: kinds("step") }] : []),
        ...(kinds("workflow") ? [{ phase: "workflows", package: ref, total: kinds("workflow") }] : []),
        ...(kinds("app") ? [{ phase: "apps", package: ref, total: kinds("app") }] : []),
        ...(concepts ? [{ phase: "concepts", package: ref, total: concepts }] : []),
        ...(concepts > 1 ? [{ phase: "concept-tree", package: ref, total: concepts - 1 }] : []),
        { phase: "claims", package: ref },
      ],
      commit: here
        ? undefined
        : () => {
            state.installed.push({ release: structuredClone(release), door: "install", ...(actor ? { actor } : {}), modified: [] });
            for (const app of release.detail?.apps ?? []) publish(`${ref}/${app.name}`, app.title);
          },
    };
  }

  /** Strut's install record over a plan: queued, fetching, the plan's phases, then done or failed, `ms` long. */
  function startInstall(ref: string, actor: string | undefined, plan: FakePlan, ms: number): FakeInstall {
    const rec: FakeInstall = {
      id: `inst_${randomBytes(8).toString("hex")}`,
      ref,
      ...(actor ? { actor } : {}),
      startedAt: Date.now(),
      ms,
      steps: [{ phase: "queued" }, { phase: "resolving" }, ...plan.steps],
      plan,
      ended: false,
    };
    state.installs.push(rec);
    if (ms === 0) endInstall(rec);
    else setTimeout(() => endInstall(rec), ms).unref();
    return rec;
  }

  /** The install's writes, once, when it ends. */
  function endInstall(rec: FakeInstall) {
    if (rec.ended) return;
    rec.ended = true;
    rec.plan.commit?.();
  }

  /** The record as `GET /packages/installs/:id` answers it at `now`. */
  function installView(rec: FakeInstall, now: number) {
    const base = { id: rec.id, ref: rec.ref, door: "install", ...(rec.actor ? { actor: rec.actor } : {}), startedAt: rec.startedAt };
    const elapsed = now - rec.startedAt;
    if (elapsed >= rec.ms) {
      endInstall(rec);
      const finishedAt = rec.startedAt + rec.ms;
      const last = rec.steps.at(-1)!;
      return rec.plan.status === 201
        ? { ...base, status: "done", phase: last.phase, updatedAt: finishedAt, finishedAt, result: rec.plan.result }
        : { ...base, status: "failed", phase: last.phase, updatedAt: finishedAt, finishedAt, error: rec.plan.error };
    }
    const at = (elapsed / rec.ms) * rec.steps.length;
    const step = rec.steps[Math.floor(at)]!;
    return {
      ...base,
      status: step.phase === "queued" ? "queued" : "running",
      phase: step.phase,
      ...(step.package ? { package: step.package } : {}),
      ...(step.total ? { done: Math.floor((at % 1) * step.total), total: step.total } : {}),
      updatedAt: now,
    };
  }

  /**
   * Strut's packages (§16) over `state.indexes`: what is installed, search,
   * the indexes followed, install by name through them (the first whose
   * card lists the publisher, or the one `index` names) and uninstall, with
   * strut's refusals. An install publishes the package's apps, so the rail
   * lists them, and reports the secrets the store has no value for.
   */
  function packagesRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL, body: any) {
    const m = req.method;
    const actor = typeof req.headers["x-strut-actor"] === "string" ? req.headers["x-strut-actor"] : undefined;
    const info = (sub: (typeof state.followed)[number]) => {
      const ix = cardOf(sub);
      return ix
        ? { ...sub, read: { seq: 1, digest: `sha256:${"c".repeat(64)}`, at: new Date().toISOString(), url: sub.urls[0], publishers: new Set(ix.releases.map((r) => r.publisher)).size } }
        : { ...sub, error: `package_index_unreachable: no card for ${sub.key.slice(0, 8)}… at ${sub.urls.join(", ")}` };
    };
    const listed = (rec: (typeof state.installed)[number]) => {
      const full = (i: FakeRelease["items"][number]) => (i.kind === "concept" ? i.name : `${rec.release.package}/${i.name}`);
      return {
        package: rec.release.package,
        version: rec.release.version,
        digest: rec.release.digest,
        source: { ref: `pk:${rec.release.key}/${rec.release.package}`, url: rec.release.urls[0] },
        secrets: rec.release.requires?.secrets ?? rec.release.detail?.secrets ?? [],
        door: rec.door,
        items: rec.release.items.map((i) => ({
          kind: i.kind,
          name: full(i),
          ...(i.helper ? { helper: true } : {}),
          ...(i.kind === "concept" ? {} : { installed: "v1", active: rec.modified.includes(full(i)) ? "v2" : "v1" }),
          modified: rec.modified.includes(full(i)),
        })),
      };
    };
    /** The refusal set for the next write, once: true when it was sent. */
    const refused = () => {
      const r = state.refusePackage;
      state.refusePackage = null;
      if (r) send(res, r.status, { error: r.error });
      return !!r;
    };

    if (path === "/packages" && m === "GET") return send(res, 200, { packages: state.installed.map(listed) });
    if (path === "/packages/indexes" && m === "GET") return send(res, 200, { indexes: state.followed.map(info) });
    const ix = path.match(/^\/packages\/indexes\/([^/]+)$/);
    if (ix && m === "PUT") {
      const sub = { ...(body ?? {}), id: decodeURIComponent(ix[1]!) };
      const problem = indexSubscriptionProblem(sub);
      if (problem) return send(res, 400, { error: `package_index_invalid: ${problem}` });
      const clean = { id: sub.id, key: sub.key, urls: [...sub.urls], ...(sub.label !== undefined ? { label: sub.label } : {}) };
      const at = state.followed.findIndex((s) => s.id === clean.id);
      if (at >= 0) state.followed[at] = clean;
      else state.followed.push(clean);
      return send(res, 200, info(clean));
    }
    if (ix && m === "DELETE") {
      const id = decodeURIComponent(ix[1]!);
      const at = state.followed.findIndex((s) => s.id === id);
      if (at < 0) return send(res, 404, { error: `this strut server follows no index "${id}"` });
      state.followed.splice(at, 1);
      return send(res, 200, { ok: true, id });
    }
    if (path === "/packages/search" && m === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 500);
      const packages: unknown[] = [];
      const errors: Array<{ index: string; error: string }> = [];
      for (const sub of state.followed) {
        const card = cardOf(sub);
        if (!card) errors.push({ index: sub.id, error: "package_index_unreachable: its card could not be read" });
        else for (const r of card.releases.filter((r) => matches(r, q))) packages.push({ ...r, items: undefined, index: sub.id });
      }
      return send(res, 200, { packages: packages.slice(0, limit), peers: [], errors });
    }
    if (path === "/packages/install" && m === "POST") {
      const ref = body?.ref;
      // What strut refuses before anything starts: a body that is not one.
      if (typeof ref !== "string" || !ref) return send(res, 400, { error: "ref is required" });
      if (body.digest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(body.digest)) return send(res, 400, { error: "digest is sha256:<64 hex>" });
      if (body.wait !== undefined && typeof body.wait !== "boolean") return send(res, 400, { error: "wait is a boolean" });
      const plan = planInstall(ref, body, actor);
      const behind = body.wait === false && !state.installWaits;
      const rec = startInstall(ref, actor, plan, behind ? state.installMs : 0);
      // `wait: false`: the record at once, the install going on behind it; as strut, always still queued.
      if (behind) return send(res, 202, { install: { ...installView(rec, rec.startedAt), status: "queued", phase: "queued" } });
      return plan.status === 201 ? send(res, 201, plan.result) : send(res, plan.status, { error: plan.error });
    }
    if (path === "/packages/installs" && m === "GET") {
      const now = Date.now();
      return send(res, 200, { installs: state.installs.map((r) => installView(r, now)).reverse() });
    }
    const inst = path.match(/^\/packages\/installs\/([^/]+)$/);
    if (inst && m === "GET") {
      const rec = state.installs.find((r) => r.id === decodeURIComponent(inst[1]!));
      if (!rec) return send(res, 404, { error: `no install ${decodeURIComponent(inst[1]!)} here: an install's record is kept for an hour after it ends, and a restart forgets it` });
      return send(res, 200, installView(rec, Date.now()));
    }
    const one = path.match(/^\/packages\/([^/]+)\/([^/]+)$/);
    if (one && m === "DELETE") {
      const pkg = `${decodeURIComponent(one[1]!)}/${decodeURIComponent(one[2]!)}`;
      const at = state.installed.findIndex((p) => p.release.package === pkg);
      if (at < 0) return send(res, 404, { error: `package_not_installed: ${pkg} is not installed here` });
      const rec = state.installed[at]!;
      if (rec.door === "distro") return send(res, 409, { error: `package_distro_owned: ${pkg} was installed by the distro: only it updates or removes it` });
      if (refused()) return;
      const items = listed(rec).items;
      const kept = items.filter((i) => i.modified).map((i) => ({ kind: i.kind, name: i.name, reason: i.kind === "concept" ? "edited here" : "a fork: its active version was made here" }));
      const removed = items.filter((i) => !i.modified).map((i) => ({ kind: i.kind, name: i.name }));
      state.installed.splice(at, 1);
      for (const app of removed.filter((i) => i.kind === "app")) {
        state.apps = state.apps.filter((a) => a.name !== app.name);
        state.appRecords.delete(app.name);
      }
      return send(res, 200, { ok: true, package: pkg, removed, kept });
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

/**
 * The person's LiveKit token, as the voice service mints it
 * (`memberToken`): this room only, the microphone in, audio out, its own
 * attributes; good for joining for ten minutes. HS256 over the API secret,
 * which is all a LiveKit access token is.
 */
export function livekitToken(lk: FakeLivekit, identity: string, room: string): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part({
    iss: lk.apiKey,
    sub: identity,
    jti: identity,
    nbf: now,
    exp: now + 600,
    video: { room, roomJoin: true, canPublish: true, canPublishSources: ["microphone"], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: true },
  })}`;
  return `${unsigned}.${createHmac("sha256", lk.apiSecret).update(unsigned).digest("base64url")}`;
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

/** Strut's UI showing one app alone (`?app=<name>&solo=1`), as the frame opens it. It tells
 *  the host that asked (`embed_origin`) when it is on screen, as strut's does (API.md §14.3). */
function embedPage(who: { actor: string; role: string } | undefined, q: URLSearchParams, apps: FakeApp[] = [], readyAfter = 0): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const name = (q.get("app") ?? "").replace(/@v\d+$/, "");
  const app = apps.find((a) => a.name === name);
  const artifact = q.get("artifact");
  const body = !who
    ? "<p>This sign-in link has expired. Reload the page from the app you opened it in to sign in again.</p>"
    : artifact
      ? `<h1 style="font-weight:600;font-size:18px">${esc(artifact.split("/").pop() ?? artifact)}</h1>
<p>strut's artifact viewer${q.get("solo") === "1" ? " alone" : ""}: <code>${esc(artifact)}</code>, theme <code>${esc(q.get("theme") ?? "dark")}</code></p>
<p>Signed in as actor: <code>${esc(who.actor)}</code>, role <code>${esc(who.role)}</code></p>
<p>This page stands in for the file strut would show. It was opened with a one-use sign-in ticket, not the shared token.</p>`
      : !app
      ? `<p>No app <code>${esc(name || "(none)")}</code>.</p>`
      : app.admin && who.role !== "admin"
      ? `<p>${esc(app.title)} is for admins.</p>`
      : `<h1 style="font-weight:600;font-size:18px">${esc(app.title)}</h1>
<p>App: <code>${esc(app.name)}</code>${q.get("solo") === "1" ? " alone" : ""}, input <code>${esc(q.get("input") ?? "(none)")}</code>, theme <code>${esc(q.get("theme") ?? "dark")}</code></p>
<p>Signed in as actor: <code>${esc(who.actor)}</code>, role <code>${esc(who.role)}</code></p>
<p>This page stands in for strut's app host. It was opened with a one-use sign-in ticket, not the shared token.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>Strut (fake)</title>
<style>body{font:15px system-ui;margin:0;padding:32px;color:#333;background:#fafafa}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
${body}
<script>(function(){var o=new URLSearchParams(location.search).get("embed_origin");if(o&&parent!==window)setTimeout(function(){parent.postMessage({type:"strut:ready"},o)},${readyAfter})})()</script>`;
}
