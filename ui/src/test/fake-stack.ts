/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are arbitrary JSON in a test fake */
/**
 * A fake of the stadeum stack on one port, for tests and local runs:
 *   /bifrost  — gateway: /_plugin/* (Bearer) and /api/* (Basic)
 *   /mcp      — mcp: /mint-token, the embedded Strut UI at /lab/, and the
 *               lab's delegation and secret routes
 *   /neo4j    — HTTP discovery
 * Wire shapes follow docs/mothership-spec.md. The delegation PUT runs
 * Strut's own shape check and verifies the macaroon against the org key
 * the trust registry holds, like the real gateway would.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeMacaroon, verify } from "gatekey";

import { checkDelegationShape } from "./strut-shape";

export interface FakeStackOptions {
  token?: string;
  adminUser?: string;
  adminPass?: string;
  providers?: string[];
}

export interface FakeState {
  customers: Array<{ id: string; name: string; created_at: string }>;
  vks: Array<{ id: string; name: string; value: string; customer_id: string; created_at: string; provider_configs: unknown[] }>;
  trust: Map<string, { org_id: string; pubkey: string; issuer_url: string; revocation_poll_seconds: number }>;
  realmId: string;
  agents: unknown[];
  delegations: Map<string, { actor: string; exp: string; delegationId: string; apiKey: string; baseUrl: string }>;
  secrets: Map<string, string>;
  requests: string[];
  /** Flip to simulate an outage of one service. */
  down: { bifrost: boolean; mcp: boolean; neo4j: boolean };
}

export async function startFakeStack(opts: FakeStackOptions = {}, port = 0) {
  const token = opts.token ?? "fake-shared-token";
  const adminUser = opts.adminUser ?? "admin";
  const adminPass = opts.adminPass ?? "fake-admin-pass";
  const providers = opts.providers ?? ["anthropic", "openai"];
  const basic = `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}`;

  const state: FakeState = {
    customers: [],
    vks: [],
    trust: new Map(),
    realmId: "",
    agents: [],
    delegations: new Map(),
    secrets: new Map(),
    requests: [],
    down: { bifrost: false, mcp: false, neo4j: false },
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
      if (url.pathname.startsWith("/mcp/")) {
        if (state.down.mcp) return send(res, 503, { error: "down" });
        return mcp(req, res, url.pathname.slice("/mcp".length), url, body);
      }
      if (url.pathname === "/neo4j/" || url.pathname === "/neo4j") {
        if (state.down.neo4j) return send(res, 503, { error: "down" });
        return send(res, 200, { bolt_direct: "bolt://neo4j:7687", neo4j_version: "5.19.0", neo4j_edition: "community" });
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
      if (path === "/_plugin/agents" && m === "POST") {
        state.agents = body.agents;
        return send(res, 200, { written: { agents: body.agents.length, prompts: 0, tools: 0, skills: 0 } });
      }
      return send(res, 404, "not found");
    }
    if (path.startsWith("/api/")) {
      if (req.headers.authorization !== basic) return send(res, 401, { error: "unauthorized" });
      if (path === "/api/providers") return send(res, 200, { providers: providers.map((name) => ({ name })), total: providers.length });
      if (path === "/api/governance/customers" && m === "GET") {
        const q = url.searchParams.get("search") ?? "";
        const customers = state.customers.filter((c) => c.name.includes(q));
        return send(res, 200, { customers, count: customers.length, total_count: customers.length, limit: 50, offset: 0 });
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
          if (!providers.includes(pc.provider)) return send(res, 400, { error: `provider ${pc.provider} not configured` });
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
        if (m === "PUT") vk.provider_configs = body.provider_configs;
        return send(res, 200, { virtual_key: vk });
      }
    }
    send(res, 404, { error: "not found" });
  }

  function mcp(req: IncomingMessage, res: ServerResponse, path: string, url: URL, body: any) {
    const m = req.method;
    if (path === "/mint-token" && m === "POST") {
      if (req.headers["x-api-token"] !== token) return send(res, 401, { error: "Unauthorized" });
      return send(res, 200, { token: signJwt({ scope: "api", sub: body.sub }, token), expires_in: body.expires_in, scope: "api", sub: body.sub });
    }
    if (path === "/lab/" && m === "GET") {
      const claims = verifyJwt(url.searchParams.get("key") ?? "", token);
      if (!claims) return send(res, 401, "unauthorized");
      return html(res, embedPage(claims.sub, url.searchParams.get("wf")));
    }
    if (!path.startsWith("/lab/")) return send(res, 404, { error: "not found" });
    if (req.headers["x-api-token"] !== token) return send(res, 401, { error: "Unauthorized" });
    const lab = path.slice("/lab".length);
    if (lab === "/llm/mothership") return send(res, 200, { enabled: true });
    if (lab === "/llm/delegations" && m === "GET") {
      return send(res, 200, [...state.delegations.values()].map(({ actor, exp, delegationId }) => ({ actor, exp, delegationId })));
    }
    const del = lab.match(/^\/llm\/delegations\/([^/]+)$/);
    if (del) {
      const who = decodeURIComponent(del[1]!);
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "Unauthorized" });
      if (m === "DELETE") return state.delegations.delete(who) ? send(res, 200, { ok: true }) : send(res, 404, { error: "none" });
      if (m === "PUT") {
        if (!/^https?:\/\//.test(body.baseUrl ?? "")) return send(res, 400, { error: "baseUrl must be http(s)" });
        if (!body.apiKey) return send(res, 400, { error: "apiKey required" });
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
    const sec = lab.match(/^\/actors\/([^/]+)\/secrets\/([^/]+)$/);
    if (sec && m === "PUT") {
      state.secrets.set(`${decodeURIComponent(sec[1]!)}/${sec[2]}`, body.value);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${actual}`;
  return {
    state,
    base,
    bifrostUrl: `${base}/bifrost`,
    mcpUrl: `${base}/mcp`,
    neo4jUrl: `${base}/neo4j`,
    token,
    adminUser,
    adminPass,
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

function html(res: ServerResponse, body: string) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** HS256 check, as mcp's `labAuthorized` does. Exported so tests can read a minted key. */
export function verifyJwt(jwt: string, secret: string): { sub?: string; scope?: string } | null {
  const [head, body, sig] = jwt.split(".");
  if (!head || !body || !sig) return null;
  if (createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url") !== sig) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function embedPage(actor: string | undefined, wf: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Strut (fake)</title>
<style>body{font:15px system-ui;margin:0;padding:32px;color:#333;background:#fafafa}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
<h1 style="font-weight:600;font-size:18px">Strut web UI (fake)</h1>
<p>Workflow: <code>${esc(wf ?? "(none)")}</code></p>
<p>Signed in as actor: <code>${esc(actor ?? "(none)")}</code></p>
<p>This page stands in for <code>{mcp}/lab/</code>. It was loaded with a per-person mint-token JWT, not the shared token.</p>`;
}
