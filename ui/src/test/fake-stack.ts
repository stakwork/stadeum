/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are arbitrary JSON in a test fake */
/**
 * A fake of the stadeum stack on one port, for tests and local runs:
 *   /bifrost  — gateway: /_plugin/* (Bearer) and /api/* (Basic)
 *   /strut    — strut: /health, /apps (the list, each app's versions,
 *               usage, what is live and the pin), /auth/ticket and the app
 *               page a ticket opens, /llm/delegations,
 *               /actors/:actor/secrets (strut specs/API.md)
 *   /neo4j    — HTTP discovery
 * Wire shapes follow docs/mothership-spec.md. The delegation PUT runs
 * Strut's own shape check and verifies the macaroon against the org key
 * the trust registry holds, like the real gateway would.
 */
import { randomBytes, randomUUID } from "node:crypto";
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

export interface FakeState {
  customers: Array<{ id: string; name: string; created_at: string }>;
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
  /** Sign-in tickets strut minted: who each signs in, until when, whether spent. */
  tickets: Map<string, { actor: string; exp: number; used: boolean }>;
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
    customers: [],
    vks: [],
    trust: new Map(),
    realmId: "",
    agents: [],
    delegations: new Map(),
    secrets: new Map(),
    apps: SEEDED_APPS.map((a) => ({ ...a })),
    appRecords: new Map(SEEDED_APPS.map((a) => [a.name, seededRecord()])),
    refuseRelease: null,
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
      return html(res, embedPage(t.actor, url.searchParams, state.apps));
    }
    if (!keyed) return send(res, 401, { error: "unauthorized" });
    if (path === "/auth/ticket" && m === "POST") {
      const actor = typeof body?.actor === "string" ? body.actor.trim() : "";
      if (!actor || actor.length > 120) return send(res, 400, { error: "actor is required" });
      const ticket = `strut-ticket.${randomBytes(16).toString("base64url")}`;
      const exp = Date.now() + 60_000;
      state.tickets.set(ticket, { actor, exp, used: false });
      return send(res, 200, { ticket, expiresAt: exp });
    }
    if (path === "/apps" && m === "GET") {
      const listed = [...state.apps].sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
        const warnings = state.appRecords.get(a.name)?.warnings.filter((w) => w.version === a.activeVersion).length ?? 0;
        return warnings ? { ...a, warnings } : a;
      });
      return send(res, 200, { apps: listed });
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
function embedPage(actor: string | undefined, q: URLSearchParams, apps: FakeApp[] = []): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const name = q.get("app") ?? "";
  const app = apps.find((a) => a.name === name);
  const body = !actor
    ? "<p>This sign-in link has expired. Reload the page from the app you opened it in to sign in again.</p>"
    : !app
      ? `<p>No app <code>${esc(name || "(none)")}</code>.</p>`
      : `<h1 style="font-weight:600;font-size:18px">${esc(app.title)}</h1>
<p>App: <code>${esc(app.name)}</code>${q.get("solo") === "1" ? " alone" : ""}, input <code>${esc(q.get("input") ?? "(none)")}</code>, theme <code>${esc(q.get("theme") ?? "dark")}</code></p>
<p>Signed in as actor: <code>${esc(actor)}</code></p>
<p>This page stands in for strut's app host. It was opened with a one-use sign-in ticket, not the shared token.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>Strut (fake)</title>
<style>body{font:15px system-ui;margin:0;padding:32px;color:#333;background:#fafafa}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
${body}`;
}
