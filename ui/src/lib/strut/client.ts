import { env } from "@/lib/env";
import { requireSharedToken } from "@/lib/mothership/admin-credentials";

/**
 * The strut client: stadeum-ui reaches strut through its HTTP API (strut
 * `specs/API.md`) from here and nowhere else. Every call carries the
 * deployment key, `Authorization: Bearer <SHARED_API_TOKEN>` (strut's
 * `STRUT_API_KEY`), which never leaves the server: a browser gets a
 * per-person sign-in ticket instead.
 */

export const STRUT_HTTP_TIMEOUT_MS = 10_000;

export class StrutHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Strut's own `{ error }`, as it wrote it: what a person may read. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "StrutHttpError";
  }
}

/** Strut answered 404 for `/llm/delegations`: it runs without `STRUT_MOTHERSHIP=1`. */
export class DelegationsUnsupportedError extends Error {
  constructor(base: string) {
    super(`${base} has no /llm/delegations route (STRUT_MOTHERSHIP is off)`);
    this.name = "DelegationsUnsupportedError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

/** `actor`: who a write is for (`x-strut-actor`, beside the key): strut stamps it, e.g. as a release's `by`. */
async function strutFetch(method: Method, path: string, body?: unknown, timeoutMs = STRUT_HTTP_TIMEOUT_MS, actor?: string): Promise<Response> {
  const token = requireSharedToken();
  return fetch(`${env.strutUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(actor ? { "x-strut-actor": actor } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const errorText = async (res: Response) => (await res.text().catch(() => "")).slice(0, 300);

async function fail(method: Method, path: string, res: Response): Promise<never> {
  const text = await errorText(res);
  let detail: string | undefined;
  try {
    const { error } = JSON.parse(text) as { error?: unknown };
    if (typeof error === "string" && error) detail = error;
  } catch {
    // Not JSON: no message of strut's to show.
  }
  throw new StrutHttpError(res.status, `${method} ${path} returned ${res.status}: ${text}`, detail);
}

// ── health ──────────────────────────────────────────────────────────────

export interface StrutHealth {
  ok: boolean;
  /** Present only when the key was accepted: the keyless answer is `{ ok }`. */
  stepCount?: number;
  workspace?: { backend: string; path?: string };
  drain?: { since: string; reason?: string; until?: string; idle: boolean };
}

/** `GET /health` with the key, for the status page. */
export async function health(timeoutMs?: number): Promise<StrutHealth> {
  const res = await strutFetch("GET", "/health", undefined, timeoutMs);
  if (!res.ok) await fail("GET", "/health", res);
  return (await res.json()) as StrutHealth;
}

// ── delegations (strut src/mothership.ts) ───────────────────────────────

export interface DelegationSummary {
  actor: string;
  /** RFC 3339; the earlier of the UA's and the invocation's expiry. */
  exp: string;
  delegationId: string;
}

const isSummary = (d: unknown): d is DelegationSummary =>
  !!d &&
  typeof d === "object" &&
  typeof (d as DelegationSummary).actor === "string" &&
  typeof (d as DelegationSummary).exp === "string" &&
  typeof (d as DelegationSummary).delegationId === "string";

export async function listDelegations(): Promise<DelegationSummary[]> {
  const res = await strutFetch("GET", "/llm/delegations");
  if (res.status === 404) throw new DelegationsUnsupportedError(env.strutUrl());
  if (!res.ok) await fail("GET", "/llm/delegations", res);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("GET /llm/delegations did not return a list");
  return data.filter(isSummary);
}

/** `PUT /llm/delegations/:actor`. Strut 400s a macaroon of the wrong shape. */
export async function putDelegation(
  actor: string,
  body: { macaroon: string; apiKey: string; baseUrl: string },
): Promise<DelegationSummary> {
  const path = `/llm/delegations/${encodeURIComponent(actor)}`;
  const res = await strutFetch("PUT", path, body);
  if (!res.ok) await fail("PUT", path, res);
  const data = (await res.json().catch(() => ({}))) as Partial<DelegationSummary>;
  if (typeof data.exp !== "string" || typeof data.delegationId !== "string") {
    throw new Error(`PUT ${path} returned no exp / delegationId`);
  }
  return { actor: data.actor ?? actor, exp: data.exp, delegationId: data.delegationId };
}

/** `false` when strut held none. */
export async function deleteDelegation(actor: string): Promise<boolean> {
  const path = `/llm/delegations/${encodeURIComponent(actor)}`;
  const res = await strutFetch("DELETE", path);
  if (res.status === 404) return false;
  if (!res.ok) await fail("DELETE", path, res);
  return true;
}

// ── a person's secrets ──────────────────────────────────────────────────

/** Strut's rule for a secret name (`isValidSecretName`). */
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ActorSecretStatus = "skipped" | "pushed" | "unsupported" | "failed";

/**
 * `PUT /actors/:actor/secrets/:NAME { value }` — e.g. a person's
 * `GITHUB_TOKEN` for steps that clone code. Never throws; never logs the value.
 */
export async function pushActorSecret(actor: string, name: string, value: string | null | undefined): Promise<ActorSecretStatus> {
  if (!value) return "skipped";
  if (!SECRET_NAME_RE.test(name)) return "failed";
  try {
    const res = await strutFetch("PUT", `/actors/${encodeURIComponent(actor)}/secrets/${name}`, { value });
    if (res.status === 404) return "unsupported";
    if (!res.ok) {
      console.warn(`[strut] actor secret ${name} push for ${actor} returned ${res.status}`);
      return "failed";
    }
    return "pushed";
  } catch (err) {
    console.warn(`[strut] actor secret ${name} push for ${actor} threw: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

// ── models (strut src/llm.ts) ───────────────────────────────────────────

/** One model of `GET /llm/models`: aieo's catalog, as strut lists it. */
export interface StrutModel {
  /** aieo's provider: `anthropic`, `google`, `openrouter`, … */
  provider: string;
  /** The friendly name (`sonnet`), when the model has one. */
  alias?: string;
  modelId: string;
  /** Canonical `provider/id`: what a workflow's `model` takes. */
  name: string;
  /** The provider's default model. */
  default: boolean;
}

export interface StrutModelCatalog {
  /** The deployment's default chat model, canonical. */
  default: string;
  models: StrutModel[];
}

const isModel = (m: unknown): m is StrutModel =>
  !!m &&
  typeof m === "object" &&
  typeof (m as StrutModel).provider === "string" &&
  typeof (m as StrutModel).modelId === "string" &&
  typeof (m as StrutModel).name === "string";

/** `GET /llm/models`: the models strut knows. Stadeum keeps no list of its own. */
export async function getModelCatalog(): Promise<StrutModelCatalog> {
  const res = await strutFetch("GET", "/llm/models");
  if (!res.ok) await fail("GET", "/llm/models", res);
  const data = (await res.json()) as { default?: unknown; models?: unknown };
  return {
    default: typeof data.default === "string" ? data.default : "",
    models: Array.isArray(data.models) ? data.models.filter(isModel).map((m) => ({ ...m, default: !!m.default })) : [],
  };
}

/**
 * `PUT /secrets/:name { value }`: one of strut's deployment settings, such
 * as `STRUT_DEFAULT_MODEL`, which strut reads from its secret store before
 * its env. Throws on failure; never logs the value.
 */
export async function putDeploymentSetting(name: string, value: string): Promise<void> {
  if (!SECRET_NAME_RE.test(name)) throw new Error(`invalid setting name ${name}`);
  const path = `/secrets/${name}`;
  const res = await strutFetch("PUT", path, { value });
  if (!res.ok) await fail("PUT", path, res);
}

// ── apps (strut specs/API.md §14) ───────────────────────────────────────

/** One entry of `GET /apps`, the fields stadeum reads. */
export interface StrutApp {
  /** May carry a package prefix: `strut/jamie`, `acme/hvac/invoices`. */
  name: string;
  title: string;
  description?: string;
  /** The version people open. */
  activeVersion: string;
  /** Set only on an app pinned as a tab (`PUT /apps/:name/pin`). */
  pinned?: boolean;
  /** The live release's id, only while the app is held (§14.5). */
  live?: string;
  /** The live version's usage warnings in the last day (§14.6), when it has any. */
  warnings?: number;
}

const isApp = (a: unknown): a is StrutApp =>
  !!a && typeof a === "object" && typeof (a as StrutApp).name === "string" && !!(a as StrutApp).name;

const appPath = (name: string, rest = "") => `/apps/${encodeURIComponent(name)}${rest}`;

/** `GET /apps`: every app in strut's workspace, as strut lists them. */
export async function listApps(timeoutMs?: number): Promise<StrutApp[]> {
  const res = await strutFetch("GET", "/apps", undefined, timeoutMs);
  if (!res.ok) await fail("GET", "/apps", res);
  const { apps } = (await res.json()) as { apps?: unknown };
  if (!Array.isArray(apps)) throw new Error("GET /apps returned no apps list");
  return apps.filter(isApp).map((a) => ({
    name: a.name,
    title: typeof a.title === "string" && a.title ? a.title : a.name,
    ...(typeof a.description === "string" && a.description ? { description: a.description } : {}),
    activeVersion: typeof a.activeVersion === "string" ? a.activeVersion : "",
    ...(a.pinned === true ? { pinned: true } : {}),
    ...(typeof a.live === "string" && a.live ? { live: a.live } : {}),
    ...(typeof a.warnings === "number" && a.warnings > 0 ? { warnings: a.warnings } : {}),
  }));
}

/** `GET /apps/:name/versions`, without `behind` and the release locks, which stadeum never shows (strut's own Versions flyout doesn't). */
export interface StrutAppVersions {
  name: string;
  /** The live version. */
  active: string;
  /** `source: "seed"`: strut makes this version live at every start, so it cannot be held. */
  versions: Record<string, { createdAt: string; source?: string }>;
  /** The live release's id, or `latest` while following. */
  live: string;
  /** Oldest first. `by` is the actor who made it live. */
  releases: Array<{ id: string; version: string; createdAt: string; by?: string }>;
  pinned?: boolean;
}

export async function getAppVersions(name: string): Promise<StrutAppVersions> {
  const path = appPath(name, "/versions");
  const res = await strutFetch("GET", path);
  if (!res.ok) await fail("GET", path, res);
  const d = (await res.json()) as Partial<StrutAppVersions> & { releases?: Array<Record<string, unknown>> };
  if (typeof d.active !== "string" || !d.versions || typeof d.versions !== "object") throw new Error(`GET ${path} returned no versions`);
  const versions: StrutAppVersions["versions"] = {};
  for (const [v, info] of Object.entries(d.versions)) {
    versions[v] = { createdAt: String(info?.createdAt ?? ""), ...(typeof info?.source === "string" ? { source: info.source } : {}) };
  }
  return {
    name: d.name ?? name,
    active: d.active,
    versions,
    live: typeof d.live === "string" && d.live ? d.live : "latest",
    releases: (Array.isArray(d.releases) ? d.releases : []).map((r) => ({
      id: String(r.id),
      version: String(r.version),
      createdAt: String(r.createdAt ?? ""),
      ...(typeof r.by === "string" && r.by ? { by: r.by } : {}),
    })),
    ...(d.pinned === true ? { pinned: true } : {}),
  };
}

/** One pattern strut's usage monitor caught, on the version that caused it (§14.6). */
export interface StrutAppWarning {
  kind: string;
  version: string;
  type?: string;
  times: number;
  lastAt: string;
  message: string;
  fix: string;
}

/** `GET /apps/:name/usage`: the last day's warnings. */
export async function getAppUsage(name: string): Promise<{ warnings: StrutAppWarning[] }> {
  const path = appPath(name, "/usage");
  const res = await strutFetch("GET", path);
  if (!res.ok) await fail("GET", path, res);
  const { warnings } = (await res.json()) as { warnings?: unknown };
  return { warnings: Array.isArray(warnings) ? (warnings as StrutAppWarning[]) : [] };
}

/** What people open: `{ version: "vN" }` (held there), `{ release: "rN" }` (an earlier release again), or `{ version: "latest" }` (every publish from now on). */
export type LiveTarget = { version: string } | { release: string };

/**
 * `PUT /apps/:name/active`. A refusal throws a StrutHttpError whose
 * `detail` is strut's message: 409 for a version that no longer builds, an
 * app strut seeds, or a release whose lock names something gone.
 */
export async function setAppLive(name: string, target: LiveTarget, actor: string): Promise<{ active: string; live: string }> {
  const path = appPath(name, "/active");
  const res = await strutFetch("PUT", path, target, undefined, actor);
  if (!res.ok) await fail("PUT", path, res);
  const d = (await res.json()) as { active?: string; live?: string };
  return { active: d.active ?? "", live: d.live ?? "latest" };
}

/** `PUT /apps/:name/pin`. Pinning an app that follows latest also holds it at its live version. */
export async function setAppPinned(name: string, pinned: boolean, actor: string): Promise<{ pinned: boolean; live: string }> {
  const path = appPath(name, "/pin");
  const res = await strutFetch("PUT", path, { pinned }, undefined, actor);
  if (!res.ok) await fail("PUT", path, res);
  const d = (await res.json()) as { pinned?: boolean; live?: string };
  return { pinned: d.pinned === true, live: d.live ?? "latest" };
}

// ── the brand (strut specs/API.md §14.12) ───────────────────────────────

/** The look of every app on the box. A field left out is the kit's own. */
export interface StrutBrand {
  /** `#rrggbb`: primary buttons, switches, the selected item, focus rings. */
  color?: string;
  /** The same in the dark theme. Each color falls back to the other. */
  colorDark?: string;
  /** `0`, or a length in px, rem or em. */
  radius?: string;
  /** A font-family list. */
  font?: string;
}

/** What strut's host sends every app page: each theme's MCP Apps style variables. Null for an empty brand. */
export type StrutBrandStyles = Record<"light" | "dark", { variables: Record<string, string> }> | null;

const BRAND_FIELDS = ["color", "colorDark", "radius", "font"] as const;

function readBrand(data: unknown): { brand: StrutBrand; styles: StrutBrandStyles } {
  const { brand, styles } = (data ?? {}) as { brand?: Record<string, unknown>; styles?: unknown };
  const out: StrutBrand = {};
  for (const k of BRAND_FIELDS) {
    const v = brand?.[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return { brand: out, styles: styles && typeof styles === "object" ? (styles as StrutBrandStyles) : null };
}

/** Strut has no `/brand`: it is older than branding (stakwork/strut#538). */
export class BrandUnsupportedError extends Error {
  constructor(base: string) {
    super(`${base} has no /brand route (strut is older than branding)`);
    this.name = "BrandUnsupportedError";
  }
}

/**
 * `GET /brand`. An older strut answers 404, or its web UI's page (its
 * catch-all `GET *`): a BrandUnsupportedError.
 */
export async function getBrand(timeoutMs?: number): Promise<{ brand: StrutBrand; styles: StrutBrandStyles }> {
  const res = await strutFetch("GET", "/brand", undefined, timeoutMs);
  if (res.status === 404) throw new BrandUnsupportedError(env.strutUrl());
  if (!res.ok) await fail("GET", "/brand", res);
  if (!res.headers.get("content-type")?.includes("application/json")) throw new BrandUnsupportedError(env.strutUrl());
  return readBrand(await res.json());
}

/**
 * `PUT /brand`: replaces the whole brand, so a field left out is unset and
 * `{}` resets it. A bad field is a 400 whose `detail` is strut's message,
 * and nothing changes.
 */
export async function putBrand(brand: StrutBrand): Promise<{ brand: StrutBrand; styles: StrutBrandStyles }> {
  const body: StrutBrand = {};
  for (const k of BRAND_FIELDS) if (brand[k]) body[k] = brand[k];
  const res = await strutFetch("PUT", "/brand", body);
  if (!res.ok) await fail("PUT", "/brand", res);
  return readBrand(await res.json());
}

// ── the frame ───────────────────────────────────────────────────────────

/**
 * One strut app for one person, to frame: `POST /auth/ticket { actor }`
 * mints a sign-in ticket (good once, for a minute), and strut's UI loaded
 * with `?ticket=` trades it for its own session cookie as that actor
 * (strut `specs/API.md` §13.1), then shows the app's page alone (`solo=1`,
 * §14.3). `input` is the app's own query, the deep link it reports back
 * (`strut:location`). Mint one per page load. The cookie reaches the frame
 * only because STRUT_PUBLIC_URL is a subdomain of stadeum-ui's site.
 */
export async function embedUrl(actor: string, app: string, input?: string): Promise<string> {
  const res = await strutFetch("POST", "/auth/ticket", { actor });
  if (!res.ok) await fail("POST", "/auth/ticket", res);
  const { ticket } = (await res.json()) as { ticket?: unknown };
  if (typeof ticket !== "string" || !ticket) throw new Error("POST /auth/ticket returned no ticket");

  const url = new URL(`${env.strutPublicUrl()}/`);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("app", app);
  url.searchParams.set("solo", "1");
  url.searchParams.set("embed_origin", new URL(env.publicUrl()).origin);
  if (input) url.searchParams.set("input", input);
  return url.toString();
}
