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

async function strutFetch(method: Method, path: string, body?: unknown, timeoutMs = STRUT_HTTP_TIMEOUT_MS): Promise<Response> {
  const token = requireSharedToken();
  return fetch(`${env.strutUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const errorText = async (res: Response) => (await res.text().catch(() => "")).slice(0, 300);

async function fail(method: Method, path: string, res: Response): Promise<never> {
  throw new StrutHttpError(res.status, `${method} ${path} returned ${res.status}: ${await errorText(res)}`);
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

// ── apps (strut specs/API.md §14) ───────────────────────────────────────

/** One entry of `GET /apps`, the fields stadeum reads. */
export interface StrutApp {
  /** May carry a package prefix: `strut/jamie`, `acme/hvac/invoices`. */
  name: string;
  title: string;
  description?: string;
  /** Set only on an app pinned as a tab (`PUT /apps/:name/pin`). */
  pinned?: boolean;
}

const isApp = (a: unknown): a is StrutApp =>
  !!a && typeof a === "object" && typeof (a as StrutApp).name === "string" && !!(a as StrutApp).name;

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
    ...(a.pinned === true ? { pinned: true } : {}),
  }));
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
