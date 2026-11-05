import { labBase } from "@/lib/env";
import { requireSharedToken } from "./admin-credentials";
import { STRUT_HTTP_TIMEOUT_MS } from "./constants";

/**
 * Strut lab delegation and actor-secret routes. Ported from Hive
 * `strut-delegation.ts:161-245` and `strut-actor-secret.ts`.
 *
 * mcp's lab gate reads `x-api-token`; Strut's `requireApiKey` reads the
 * Bearer. Both are `SHARED_API_TOKEN`.
 */

export interface DelegationSummary {
  actor: string;
  /** RFC 3339; the earlier of the UA's and the invocation's expiry. */
  exp: string;
  delegationId: string;
}

/** The lab answered 404 for `/llm/delegations`: Mothership not mounted. */
export class DelegationsUnsupportedError extends Error {
  constructor(base: string) {
    super(`${base} has no /llm/delegations route (Mothership module not mounted)`);
    this.name = "DelegationsUnsupportedError";
  }
}

export class StrutLabHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StrutLabHttpError";
  }
}

export function labHeaders(actor?: string): Record<string, string> {
  const token = requireSharedToken();
  return {
    "Content-Type": "application/json",
    "x-api-token": token,
    Authorization: `Bearer ${token}`,
    ...(actor ? { "x-strut-actor": actor } : {}),
  };
}

async function labFetch(method: "GET" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  const base = labBase();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: labHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(STRUT_HTTP_TIMEOUT_MS),
  });
  if (res.status === 404 && path === "/llm/delegations") throw new DelegationsUnsupportedError(base);
  return res;
}

const errorText = async (res: Response) => (await res.text().catch(() => "")).slice(0, 300);

export async function listDelegations(): Promise<DelegationSummary[]> {
  const res = await labFetch("GET", "/llm/delegations");
  if (!res.ok) throw new StrutLabHttpError(res.status, `GET /llm/delegations returned ${res.status}: ${await errorText(res)}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("GET /llm/delegations did not return a list");
  return data.filter(
    (d): d is DelegationSummary =>
      !!d &&
      typeof d === "object" &&
      typeof (d as DelegationSummary).actor === "string" &&
      typeof (d as DelegationSummary).exp === "string" &&
      typeof (d as DelegationSummary).delegationId === "string",
  );
}

/** `PUT /llm/delegations/:actor`. Strut 400s a macaroon of the wrong shape. */
export async function putDelegation(
  actor: string,
  body: { macaroon: string; apiKey: string; baseUrl: string },
): Promise<DelegationSummary> {
  const res = await labFetch("PUT", `/llm/delegations/${encodeURIComponent(actor)}`, body);
  if (!res.ok) {
    throw new StrutLabHttpError(res.status, `PUT /llm/delegations/${actor} returned ${res.status}: ${await errorText(res)}`);
  }
  const data = (await res.json().catch(() => ({}))) as Partial<DelegationSummary>;
  if (typeof data.exp !== "string" || typeof data.delegationId !== "string") {
    throw new Error(`PUT /llm/delegations/${actor} returned no exp / delegationId`);
  }
  return { actor: data.actor ?? actor, exp: data.exp, delegationId: data.delegationId };
}

/** `false` when Strut held none. */
export async function deleteDelegation(actor: string): Promise<boolean> {
  const res = await labFetch("DELETE", `/llm/delegations/${encodeURIComponent(actor)}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new StrutLabHttpError(res.status, `DELETE /llm/delegations/${actor} returned ${res.status}`);
  return true;
}

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
    const res = await fetch(`${labBase()}/actors/${encodeURIComponent(actor)}/secrets/${name}`, {
      method: "PUT",
      headers: labHeaders(),
      body: JSON.stringify({ value }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_HTTP_TIMEOUT_MS),
    });
    if (res.status === 404) return "unsupported";
    if (!res.ok) {
      console.warn(`[mothership] actor secret ${name} push for ${actor} returned ${res.status}`);
      return "failed";
    }
    return "pushed";
  } catch (err) {
    console.warn(`[mothership] actor secret ${name} push for ${actor} threw: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}
