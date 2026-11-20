import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { isAdmin } from "@/lib/roles";
import { bounce, label, unlabel } from "@/lib/signin-bounce";
import { pushActorSecret, putDeploymentSetting } from "@/lib/strut/client";

/**
 * The connect seam (plans/software.md §2.1; docs/stack-spec.md, "The connect
 * seam"): a person connects an OAuth provider, and the tokens it gives go to
 * strut, as their secrets or, for an admin's `for=box`, the deployment's.
 * Trading the code needs the provider's client secret, which only stadeum-ui
 * holds, so this is stadeum's; everything else is a package's.
 *
 * One path for every provider. `GET /api/connect/:provider` shows the
 * person a page on the box (`/connect/:provider`) saying what they are about
 * to connect, and for whom; its Continue posts back to `/api/connect/:provider`
 * from the box's own origin, which signs a state and sends them to the
 * provider. A connect is always a person's click on the box's own page,
 * never a link they followed: the provider may skip its own consent page.
 * The `/callback` checks the state, trades the code and writes the tokens to
 * strut. The seam keeps nothing and logs no code or token.
 *
 * The table below is the only place that names a provider.
 */

/** One provider: data, read from .env when used. */
export interface Provider {
  /** Its name, as the confirm page says it. */
  name: string;
  /** The provider's address, from .env: the URLs below are paths under it. */
  base?: string;
  /** The authorize URL. */
  authorize: string;
  /** An install page, if the provider has one: `install=1` starts there. */
  install?: string;
  /** The token URL: never from a package. */
  token: string;
  /** Every scope a package may ask for. */
  scopes: string[];
  /** Where scopes go on the authorize URL: `scope` for both by default. */
  scopeParam?: { person: string; box: string };
  /** Fixed extras on the authorize URL. */
  params?: Record<string, string>;
  /** Each secret strut gets, by name: its paths in the token response, the first present wins. */
  secrets: Record<string, string[]>;
}

/** A provider with its OAuth client: what the routes use. */
export interface Connectable extends Provider {
  id: string;
  clientId: string;
  clientSecret: string;
}

const PROVIDERS: Record<string, () => Provider> = {
  // A GitHub App (plans/software.md §13): its user tokens never expire, its
  // permissions are its settings, so a package asks for no scope. Installing
  // it also authorizes the installer, who comes back to the same callback
  // with a code; `installation_id` is ignored: the package reads
  // installations itself. CONNECT_GITHUB_URL is for a fake GitHub
  // (`npm run fake-stack`), and is not handed to stadeum-ui on a box.
  github: () => {
    const slug = env.connect("github", "SLUG");
    return {
      name: "GitHub",
      base: env.connect("github", "URL") ?? "https://github.com",
      authorize: "/login/oauth/authorize",
      ...(slug ? { install: `/apps/${encodeURIComponent(slug)}/installations/new` } : {}),
      token: "/login/oauth/access_token",
      scopes: [],
      secrets: { GITHUB_TOKEN: ["access_token"] },
    };
  },
};

/** The provider, when the table has it and its client id and secret are set; else none, and its routes are a 404. */
export function connectable(id: string): Connectable | undefined {
  if (!Object.hasOwn(PROVIDERS, id)) return undefined;
  const clientId = env.connect(id, "CLIENT_ID");
  const clientSecret = env.connect(id, "CLIENT_SECRET");
  if (!clientId || !clientSecret) return undefined;
  return { ...PROVIDERS[id]!(), id, clientId, clientSecret };
}

const at = (p: Provider, url: string) => (p.base ? `${p.base.replace(/\/+$/, "")}${url}` : url);

/** The box's own origin, stadeum's: the only one a connect's Continue may come from. */
export function fromTheBox(origin: string | null): boolean {
  return !!origin && origin === new URL(env.publicUrl()).origin;
}

/** Where the provider sends the person back: the bounce's callback when the box has one, else its own. */
export function redirectUri(id: string): string {
  return `${bounce()?.origin ?? env.publicUrl()}/api/connect/${id}/callback`;
}

// ── what a connect asks for ────────────────────────────────────────────

const RETURN_MAX = 2000;

/**
 * `raw` as a URL on the box's own origins, stadeum's or strut's, so the
 * seam is no open redirect; a path is on stadeum's. Absent: stadeum's home.
 * Anything else is null.
 */
export function safeReturn(raw: string | null): string | null {
  const home = env.publicUrl();
  if (!raw) return `${home}/`;
  if (raw.length > RETURN_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw, `${home}/`);
  } catch {
    return null;
  }
  const origins = [home, env.strutPublicUrl()].map((u) => new URL(u).origin);
  return origins.includes(url.origin) ? url.toString() : null;
}

/** The scopes asked for (space- or comma-separated), when the provider lists each one; else null. */
export function askedScopes(p: Provider, raw: string | null): string[] | null {
  const asked = [...new Set((raw ?? "").split(/[\s,]+/).filter(Boolean))];
  return asked.every((s) => p.scopes.includes(s)) ? asked : null;
}

/** What a connect asks for, checked: where it comes back to, its scopes, whether it is the box's, whether it installs. */
export interface Ask {
  back: string;
  scopes: string[];
  box: boolean;
  install: boolean;
}

export type AskCheck = { ok: true; ask: Ask } | { ok: false; status: number; message: string; back?: string };

/**
 * `return`, `scope`, `install=1` and `for=box`, as the confirm page and its
 * Continue read them alike: `return` on the box's own origins, each scope one
 * the provider lists, an install page only if it has one, the box's only for
 * an admin.
 */
export function readAsk(p: Connectable, who: { role: string }, q: URLSearchParams): AskCheck {
  const back = safeReturn(q.get("return"));
  if (!back) return { ok: false, status: 400, message: "The page to come back to is not on this box." };
  const forBox = q.get("for");
  if (forBox !== null && forBox !== "box") return { ok: false, status: 400, message: "for can only be box.", back };
  if (forBox && !isAdmin(who.role)) return { ok: false, status: 403, message: "Only an admin connects for the box.", back };
  const scopes = askedScopes(p, q.get("scope"));
  if (!scopes) {
    const message = p.scopes.length ? `A scope asked for is not one of ${p.scopes.join(", ")}.` : `${p.name} takes no scope here.`;
    return { ok: false, status: 400, message, back };
  }
  const install = q.get("install") === "1";
  if (install && !p.install) return { ok: false, status: 400, message: `${p.name} has no install page here.`, back };
  return { ok: true, ask: { back, scopes, box: !!forBox, install } };
}

/** Where Continue sends the person: the provider's install page, or its authorize page. */
export function startUrl(p: Connectable, ask: Pick<Ask, "scopes" | "box" | "install"> & { state: string }): string {
  if (ask.install) {
    if (!p.install) throw new Error(`${p.id} has no install page`);
    const url = new URL(at(p, p.install));
    url.searchParams.set("state", ask.state);
    return url.toString();
  }
  const url = new URL(at(p, p.authorize));
  for (const [k, v] of Object.entries(p.params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", redirectUri(p.id));
  if (ask.scopes.length) {
    url.searchParams.set((ask.box ? p.scopeParam?.box : p.scopeParam?.person) ?? "scope", ask.scopes.join(" "));
  }
  url.searchParams.set("state", ask.state);
  return url.toString();
}

// ── the state ──────────────────────────────────────────────────────────

/** What the state carries: whose connect it is, for whom, and where it goes back to. */
export interface ConnectState {
  provider: string;
  actor: string;
  for?: "box";
  return: string;
  nonce: string;
  /** When it was signed, ms. */
  iat: number;
}

/** A state is good for an hour. */
export const STATE_TTL_MS = 60 * 60 * 1000;

function stateKey(): Buffer {
  const secret = env.authSecret();
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", "stadeum connect state", 32));
}

const sign = (body: string) => createHmac("sha256", stateKey()).update(body).digest();

/**
 * `<label>.<body>.<sig>` (`plans/github-app.md` §4): the body base64url
 * JSON, the signature HMAC-SHA256 under a key derived from `AUTH_SECRET`.
 * The label, the box's first name in clear for the bounce, only with one.
 */
export function signState(s: Pick<ConnectState, "provider" | "actor" | "for" | "return">, now = Date.now()): string {
  const state: ConnectState = { ...s, nonce: randomBytes(16).toString("base64url"), iat: now };
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return label(`${body}.${sign(body).toString("base64url")}`);
}

export type StateCheck = { ok: true; state: ConnectState } | { ok: false; why: "bad" | "expired" | "someone else" };

/** The state back from the provider, when this box signed it for this provider and person within the hour. */
export function verifyState(raw: string | null, expect: { provider: string; actor: string }, now = Date.now()): StateCheck {
  const parts = unlabel(raw ?? "").split(".");
  if (parts.length !== 2) return { ok: false, why: "bad" };
  const [body, sig] = parts as [string, string];
  const given = Buffer.from(sig, "base64url");
  const want = sign(body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, why: "bad" };
  let s: ConnectState;
  try {
    s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConnectState;
  } catch {
    return { ok: false, why: "bad" };
  }
  if (s.provider !== expect.provider || typeof s.return !== "string" || typeof s.iat !== "number") return { ok: false, why: "bad" };
  if (now - s.iat > STATE_TTL_MS) return { ok: false, why: "expired" };
  if (s.actor !== expect.actor) return { ok: false, why: "someone else" };
  return { ok: true, state: s };
}

// ── the exchange ───────────────────────────────────────────────────────

const EXCHANGE_TIMEOUT_MS = 10_000;

/** Each secret the provider's entry names that the response holds. */
export function pickSecrets(p: Pick<Provider, "secrets">, data: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [name, paths] of Object.entries(p.secrets)) {
    for (const path of paths) {
      const value = path
        .split(".")
        .reduce<unknown>((o, k) => (o && typeof o === "object" && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), data);
      if (typeof value === "string" && value) {
        found[name] = value;
        break;
      }
    }
  }
  return found;
}

/** A provider's error code, safe to show and log: never a token. */
const errorCode = (data: unknown): string | undefined => {
  const e = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  return typeof e === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e) ? e : undefined;
};

export type Exchanged = { ok: true; secrets: Record<string, string> } | { ok: false; error: string };

/**
 * Trades the code at the provider's token URL with its client id and secret.
 * A response with none of the entry's secrets is a failure, whatever its
 * status: GitHub answers a bad code, and Slack any error, with a 200.
 */
export async function exchange(p: Connectable, code: string): Promise<Exchanged> {
  const res = await fetch(at(p, p.token), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(p.id),
      client_id: p.clientId,
      client_secret: p.clientSecret,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => undefined)) as unknown;
  const secrets = res.ok ? pickSecrets(p, data) : {};
  if (Object.keys(secrets).length) return { ok: true, secrets };
  return { ok: false, error: errorCode(data) ?? `HTTP ${res.status}` };
}

/** Writes each secret to strut: the person's, or the deployment's for `for=box`. Throws when strut doesn't take one. */
export async function keep(secrets: Record<string, string>, s: Pick<ConnectState, "actor" | "for">): Promise<void> {
  for (const [name, value] of Object.entries(secrets)) {
    if (s.for === "box") {
      await putDeploymentSetting(name, value);
      continue;
    }
    const status = await pushActorSecret(s.actor, name, value);
    if (status !== "pushed") throw new Error(`strut's PUT /actors/:actor/secrets/${name} was ${status}`);
  }
}

// ── what a person sees when it fails ───────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A refusal the person reads, with a way back when there is a safe one. Never cached, never a referrer. */
export function refusal(status: number, message: string, back?: string): Response {
  const link = back ? `<p><a href="${esc(back)}">Back</a></p>` : "";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not connected</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:48px 24px;max-width:36rem}</style>
<h1 style="font-size:18px">Not connected</h1><p>${esc(message)}</p>${link}`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
    },
  );
}

/** A redirect that carries a state or ends a connect: never cached. 303 after a POST. */
export function goTo(url: string, status: 302 | 303 = 302): Response {
  return new Response(null, { status, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
