import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { bounce, label, unlabel } from "@/lib/signin-bounce";
import { pushActorSecret, type SecretRefresh } from "@/lib/strut/client";

/**
 * The connect seam (plans/software.md §2.1; docs/stack-spec.md, "The connect
 * seam"): a person connects an OAuth provider, and the tokens it gives go to
 * strut as their own secrets. Every token the seam writes is a person's.
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
 * A provider whose access tokens expire (`refresh`) gives strut its refresh
 * token too, and strut asks `POST /api/connect/:provider/refresh` for a new
 * access token when one runs out: refreshing needs the client secret as well.
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
  /** Fixed extras on the authorize URL. */
  params?: Record<string, string>;
  /** Each secret strut gets, by name: its paths in the token response, the first present wins. */
  secrets: Record<string, string[]>;
  /** The git hosts its token reads and pushes to, as strut's host map has them (strut `src/git-hosts.ts`). */
  hosts?: string[];
  /**
   * Its access tokens expire: strut gets the secret with its expiry and the
   * refresh token, and refreshes it through the seam. Such an entry names
   * one secret, the access token.
   */
  refresh?: true;
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
      hosts: ["github.com"],
    };
  },
  // A Google OAuth web client: a shared app a host gives, or the box's own
  // (plans/gmail.md §3); the seam doesn't know whose. Never the sign-in's
  // (AUTH_GOOGLE_*): Gmail's scopes are restricted. Its access tokens last
  // an hour. `access_type=offline` and `prompt=consent`
  // get a refresh token on every connect; `include_granted_scopes` adds a
  // package's scopes to what the person granted before, so one GOOGLE_TOKEN
  // serves every Google package. Google's two URLs are on two hosts:
  // CONNECT_GOOGLE_URL puts both under one, for a fake Google
  // (`npm run fake-stack`), and is not handed to stadeum-ui on a box.
  google: () => {
    const fake = env.connect("google", "URL");
    return {
      name: "Google",
      ...(fake ? { base: fake } : {}),
      authorize: fake ? "/o/oauth2/v2/auth" : "https://accounts.google.com/o/oauth2/v2/auth",
      token: fake ? "/token" : "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
      params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      secrets: { GOOGLE_TOKEN: ["access_token"] },
      refresh: true,
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

/** Every provider a person can connect on this box: its id, its name, the secrets it writes to strut, and the git hosts its token serves. */
export function connectOffers(): Array<{ id: string; name: string; secrets: string[]; hosts?: string[] }> {
  return Object.keys(PROVIDERS)
    .map(connectable)
    .filter((p): p is Connectable => !!p)
    .map((p) => ({ id: p.id, name: p.name, secrets: Object.keys(p.secrets), ...(p.hosts ? { hosts: p.hosts } : {}) }));
}

const at = (p: Provider, url: string) => (p.base ? `${p.base.replace(/\/+$/, "")}${url}` : url);

/** The box's own origin, stadeum's: the only one a connect's Continue may come from. */
export function fromTheBox(origin: string | null): boolean {
  return !!origin && origin === new URL(env.publicUrl()).origin;
}

/**
 * `Authorization: Bearer <CONNECT_TOKEN>`, compared in constant time: strut,
 * asking the refresh route for a new access token. Without CONNECT_TOKEN,
 * nobody is.
 */
export function fromStrut(authorization: string | null): boolean {
  const token = env.connectToken();
  const given = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!token || !given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(token));
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

/** What a connect asks for, checked: where it comes back to, its scopes, whether it installs. */
export interface Ask {
  back: string;
  scopes: string[];
  install: boolean;
}

export type AskCheck = { ok: true; ask: Ask } | { ok: false; status: number; message: string; back?: string };

/**
 * `return`, `scope` and `install=1`, as the confirm page and its Continue
 * read them alike: `return` on the box's own origins, each scope one the
 * provider lists, an install page only if it has one. Any other parameter
 * is ignored: a connect is always the signed-in person's own.
 */
export function readAsk(p: Connectable, q: URLSearchParams): AskCheck {
  const back = safeReturn(q.get("return"));
  if (!back) return { ok: false, status: 400, message: "The page to come back to is not on this site." };
  const scopes = askedScopes(p, q.get("scope"));
  if (!scopes) {
    const message = p.scopes.length ? "A requested permission isn’t allowed." : `${p.name} takes no scope here.`;
    return { ok: false, status: 400, message, back };
  }
  const install = q.get("install") === "1";
  if (install && !p.install) return { ok: false, status: 400, message: `${p.name} has no install page here.`, back };
  return { ok: true, ask: { back, scopes, install } };
}

/** Where Continue sends the person: the provider's install page, or its authorize page. */
export function startUrl(p: Connectable, ask: Pick<Ask, "scopes" | "install"> & { state: string }): string {
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
  if (ask.scopes.length) url.searchParams.set("scope", ask.scopes.join(" "));
  url.searchParams.set("state", ask.state);
  return url.toString();
}

// ── the state ──────────────────────────────────────────────────────────

/** What the state carries: whose connect it is, and where it goes back to. */
export interface ConnectState {
  provider: string;
  actor: string;
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
export function signState(s: Pick<ConnectState, "provider" | "actor" | "return">, now = Date.now()): string {
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

/** A field of the token response, when it is a non-empty string. */
const field = (data: unknown, key: string): string | undefined => {
  const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && v ? v : undefined;
};

/** `expires_in`, seconds: a positive whole number, or a string of one (some providers send it so). */
const expiresIn = (data: unknown): number | undefined => {
  const v = data && typeof data === "object" ? (data as { expires_in?: unknown }).expires_in : undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** A trade's secrets, and for a provider with `refresh` what strut keeps beside them to refresh them. */
export type Exchanged = { ok: true; secrets: Record<string, string>; refresh?: SecretRefresh } | { ok: false; error: string };

const TOKEN_TIMEOUT_MS = 10_000;

/** A form posted to the provider's token URL with its client id and secret: the status and the JSON it answers. */
async function tokenUrl(p: Connectable, form: Record<string, string>): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(at(p, p.token), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: p.clientId, client_secret: p.clientSecret }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  return { status: res.status, ok: res.ok, data: (await res.json().catch(() => undefined)) as unknown };
}

/**
 * Trades the code at the provider's token URL with its client id and secret.
 * A response with none of the entry's secrets is a failure, whatever its
 * status: GitHub answers a bad code, and Slack any error, with a 200. For a
 * provider with `refresh`, so is one with no expiry or no refresh token:
 * strut could not keep the secret alive.
 */
export async function exchange(p: Connectable, code: string): Promise<Exchanged> {
  const { ok, status, data } = await tokenUrl(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p.id) });
  const secrets = ok ? pickSecrets(p, data) : {};
  if (!Object.keys(secrets).length) return { ok: false, error: errorCode(data) ?? `HTTP ${status}` };
  if (!p.refresh) return { ok: true, secrets };
  const expires = expiresIn(data);
  const refreshToken = field(data, "refresh_token");
  if (!expires) return { ok: false, error: "no expires_in" };
  if (!refreshToken) return { ok: false, error: "no refresh_token" };
  return { ok: true, secrets, refresh: { expires_in: expires, refresh_token: refreshToken, provider: p.id } };
}

/**
 * Writes each secret to strut as the person's own, with what refreshes it
 * when the provider's tokens expire. Throws when strut doesn't take one.
 */
export async function keep(secrets: Record<string, string>, actor: string, refresh?: SecretRefresh): Promise<void> {
  for (const [name, value] of Object.entries(secrets)) {
    const status = await pushActorSecret(actor, name, value, refresh);
    if (status !== "pushed") throw new Error(`strut's PUT /actors/:actor/secrets/${name} was ${status}`);
  }
}

export type Refreshed =
  | { ok: true; access_token: string; expires_in: number; refresh_token?: string }
  | { ok: false; status: 400 | 502; error: string };

/**
 * A new access token for a refresh token, from the provider's token URL with
 * the client id and secret: what strut asks the refresh route for.
 * `refresh_token` is there only when the provider rotated it. Throws when
 * the provider doesn't answer.
 *
 * Only `invalid_grant`, OAuth's code for a refresh token that is revoked,
 * expired or another client's, is a refusal (400): strut then deletes the
 * secret, and the person connects again. Any other answer that isn't a
 * token is a 502, which strut retries later: `invalid_client`, say, is the
 * client's settings gone wrong, and must not cost everyone their token.
 */
export async function refreshAccess(p: Connectable, refreshToken: string): Promise<Refreshed> {
  const { ok, status, data } = await tokenUrl(p, { grant_type: "refresh_token", refresh_token: refreshToken });
  const [token] = ok ? Object.values(pickSecrets(p, data)) : [];
  const expires = expiresIn(data);
  if (token && expires) {
    const rotated = field(data, "refresh_token");
    return { ok: true, access_token: token, expires_in: expires, ...(rotated ? { refresh_token: rotated } : {}) };
  }
  const code = errorCode(data);
  if (code === "invalid_grant") return { ok: false, status: 400, error: code };
  return { ok: false, status: 502, error: code ?? (token ? "no expires_in" : `HTTP ${status}`) };
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
