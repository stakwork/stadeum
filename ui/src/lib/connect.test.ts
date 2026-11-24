import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  askedScopes,
  connectable,
  fromStrut,
  fromTheBox,
  pickSecrets,
  readAsk,
  redirectUri,
  safeReturn,
  signState,
  startUrl,
  STATE_TTL_MS,
  verifyState,
  type Connectable,
} from "./connect";

const saved = { ...process.env };
const ada = { provider: "github", actor: "ada-c1" };

beforeEach(() => {
  Object.assign(process.env, {
    AUTH_SECRET: "test-auth-secret",
    AUTH_URL: "https://acme.example.com",
    STRUT_PUBLIC_URL: "https://strut.acme.example.com",
    CONNECT_GITHUB_CLIENT_ID: "Iv23.client",
    CONNECT_GITHUB_CLIENT_SECRET: "gh-secret",
  });
});
afterEach(() => {
  process.env = { ...saved };
});

const github = () => connectable("github")!;
/** A provider shaped like Slack's (plans/software.md §2.1), to show the table's other fields at work. */
const slackLike: Connectable = {
  id: "slack",
  name: "Slack",
  clientId: "s-client",
  clientSecret: "s-secret",
  authorize: "https://slack.example/oauth/v2/authorize",
  token: "https://slack.example/api/oauth.v2.access",
  scopes: ["chat:write", "channels:read", "search:read"],
  params: { team: "T1" },
  secrets: { SLACK_TOKEN: ["authed_user.access_token", "access_token"] },
};

describe("the provider table", () => {
  it("has GitHub only when its client id and secret are both set", () => {
    expect(github()).toMatchObject({ id: "github", clientId: "Iv23.client", clientSecret: "gh-secret", scopes: [], secrets: { GITHUB_TOKEN: ["access_token"] } });
    delete process.env.CONNECT_GITHUB_CLIENT_SECRET;
    expect(connectable("github")).toBeUndefined();
    process.env.CONNECT_GITHUB_CLIENT_SECRET = "gh-secret";
    delete process.env.CONNECT_GITHUB_CLIENT_ID;
    expect(connectable("github")).toBeUndefined();
  });

  it("knows no other provider, nor anything an object has of its own", () => {
    for (const id of ["slack", "GITHUB", "GOOGLE", "__proto__", "constructor", "toString", ""]) expect(connectable(id)).toBeUndefined();
  });

  it("has Google only with its connect client set, never with the sign-in's", () => {
    Object.assign(process.env, { AUTH_GOOGLE_ID: "signin.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "signin-secret" });
    expect(connectable("google")).toBeUndefined();
    process.env.CONNECT_GOOGLE_CLIENT_ID = "box.apps.googleusercontent.com";
    expect(connectable("google")).toBeUndefined();
    process.env.CONNECT_GOOGLE_CLIENT_SECRET = "GOCSPX-box";
    expect(connectable("google")).toMatchObject({ id: "google", clientId: "box.apps.googleusercontent.com", clientSecret: "GOCSPX-box" });
  });

  it("has Google's two URLs, Gmail's two scopes, a refresh token on every connect, and GOOGLE_TOKEN that refreshes", () => {
    Object.assign(process.env, { CONNECT_GOOGLE_CLIENT_ID: "box.apps.googleusercontent.com", CONNECT_GOOGLE_CLIENT_SECRET: "GOCSPX-box" });
    const google = connectable("google")!;
    expect(google).toMatchObject({
      name: "Google",
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
      params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      secrets: { GOOGLE_TOKEN: ["access_token"] },
      refresh: true,
    });
    expect(google.base).toBeUndefined();
    expect(github().refresh).toBeUndefined();

    const url = new URL(startUrl(google, { state: "s.t", scopes: google.scopes, install: false }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      response_type: "code",
      client_id: "box.apps.googleusercontent.com",
      redirect_uri: "https://acme.example.com/api/connect/google/callback",
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
      state: "s.t",
    });
  });

  it("puts both of Google's URLs under CONNECT_GOOGLE_URL, a fake Google's", () => {
    Object.assign(process.env, { CONNECT_GOOGLE_CLIENT_ID: "c", CONNECT_GOOGLE_CLIENT_SECRET: "s", CONNECT_GOOGLE_URL: "http://127.0.0.1:4555/google" });
    const google = connectable("google")!;
    expect(new URL(startUrl(google, { state: "s.t", scopes: [], install: false })).pathname).toBe("/google/o/oauth2/v2/auth");
    expect(google).toMatchObject({ base: "http://127.0.0.1:4555/google", token: "/token" });
  });

  it("has GitHub's install page only with its slug, and github.com unless CONNECT_GITHUB_URL says otherwise", () => {
    expect(github().install).toBeUndefined();
    expect(github().base).toBe("https://github.com");
    process.env.CONNECT_GITHUB_SLUG = "stadeum";
    process.env.CONNECT_GITHUB_URL = "http://127.0.0.1:4555/github/";
    expect(github()).toMatchObject({ install: "/apps/stadeum/installations/new", base: "http://127.0.0.1:4555/github/" });
  });
});

describe("the state", () => {
  it("is <body>.<sig>, and comes back as it was signed", () => {
    const raw = signState({ ...ada, return: "https://acme.example.com/" });
    expect(raw.split(".")).toHaveLength(2);
    const back = verifyState(raw, ada);
    expect(back.ok && back.state).toMatchObject({ ...ada, return: "https://acme.example.com/" });
    expect(back.ok && Object.keys(back.state).sort()).toEqual(["actor", "iat", "nonce", "provider", "return"]);
    expect(back.ok && back.state.nonce).toMatch(/^[\w-]{22}$/);
  });

  it("is new each time, from the same ask", () => {
    const ask = { ...ada, return: "https://acme.example.com/" };
    expect(signState(ask, 1000)).not.toBe(signState(ask, 1000));
  });

  it("lasts an hour", () => {
    const now = Date.now();
    const raw = signState({ ...ada, return: "https://acme.example.com/" }, now);
    expect(verifyState(raw, ada, now + STATE_TTL_MS).ok).toBe(true);
    expect(verifyState(raw, ada, now + STATE_TTL_MS + 1)).toEqual({ ok: false, why: "expired" });
  });

  it("is someone else's when it names another person", () => {
    const raw = signState({ ...ada, return: "https://acme.example.com/" });
    expect(verifyState(raw, { provider: "github", actor: "bob-c2" })).toEqual({ ok: false, why: "someone else" });
  });

  it("is bad when changed, made under another secret, for another provider, or missing", () => {
    const raw = signState({ ...ada, return: "https://acme.example.com/" });
    const [body, sig] = raw.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), return: "https://evil.example/" })).toString("base64url");
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
    for (const bad of [`${forged}.${sig}`, `${body}.${flipped}`, `${body}.`, body, `${body}.${sig}.x`, "", "a.b"]) {
      expect(verifyState(bad, ada)).toEqual({ ok: false, why: "bad" });
    }
    expect(verifyState(null, ada)).toEqual({ ok: false, why: "bad" });
    expect(verifyState(raw, { provider: "slack", actor: "ada-c1" })).toEqual({ ok: false, why: "bad" });
    process.env.AUTH_SECRET = "another-box";
    expect(verifyState(raw, ada)).toEqual({ ok: false, why: "bad" });
  });

  it("refuses to sign without AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET;
    expect(() => signState({ ...ada, return: "https://acme.example.com/" })).toThrow(/AUTH_SECRET/);
  });

  it("has the box's label in front with a bounce, which it takes off again; another box's label is bad", () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com";
    const raw = signState({ ...ada, return: "https://acme.example.com/" });
    expect(raw.startsWith("acme.")).toBe(true);
    expect(raw.split(".")).toHaveLength(3);
    expect(verifyState(raw, ada).ok).toBe(true);
    expect(verifyState(raw.replace(/^acme\./, "other."), ada)).toEqual({ ok: false, why: "bad" });
    expect(verifyState(raw.replace(/^acme\./, ""), ada).ok).toBe(true);
    delete process.env.STADEUM_SIGNIN_BOUNCE;
    expect(verifyState(raw, ada)).toEqual({ ok: false, why: "bad" });
  });
});

describe("return", () => {
  it("is a page on stadeum's origin or strut's", () => {
    expect(safeReturn(null)).toBe("https://acme.example.com/");
    expect(safeReturn("")).toBe("https://acme.example.com/");
    expect(safeReturn("/apps/stadeum/github?x=1")).toBe("https://acme.example.com/apps/stadeum/github?x=1");
    expect(safeReturn("https://acme.example.com/packages")).toBe("https://acme.example.com/packages");
    expect(safeReturn("https://strut.acme.example.com/?app=stadeum/github")).toBe("https://strut.acme.example.com/?app=stadeum/github");
  });

  it("is refused anywhere else", () => {
    for (const raw of [
      "https://evil.example/",
      "//evil.example/x",
      "https://acme.example.com.evil.example/",
      "http://acme.example.com/",
      "https://other.example.com/",
      "https://acme.example.com:8443/",
      "javascript:alert(1)",
      "data:text/html,hi",
      `/${"x".repeat(2000)}`,
    ]) {
      expect(safeReturn(raw), raw).toBeNull();
    }
  });
});

describe("what a connect asks for", () => {
  const ask = (query: string) => readAsk(github(), new URLSearchParams(query));

  it("is the person's own, back home, with nothing asked", () => {
    expect(ask("")).toEqual({ ok: true, ask: { back: "https://acme.example.com/", scopes: [], install: false } });
    expect(ask("return=/apps/x")).toMatchObject({ ok: true, ask: { back: "https://acme.example.com/apps/x" } });
  });

  it("is always the person's own: a for=box from before the box token went is ignored", () => {
    expect(ask("for=box&return=/apps/x")).toEqual(ask("return=/apps/x"));
  });

  it("comes back only to the box's own origins, and offers no way back otherwise", () => {
    expect(ask("return=https%3A%2F%2Fevil.example%2F")).toEqual({ ok: false, status: 400, message: "The page to come back to is not on this site." });
  });

  it("asks for no scope GitHub doesn't list, and installs only with an install page", () => {
    expect(ask("scope=repo")).toMatchObject({ ok: false, status: 400, message: "GitHub takes no scope here." });
    expect(ask("install=1")).toMatchObject({ ok: false, status: 400, message: "GitHub has no install page here." });
    process.env.CONNECT_GITHUB_SLUG = "stadeum";
    expect(ask("install=1")).toMatchObject({ ok: true, ask: { install: true } });
  });
});

describe("strut, on the refresh route", () => {
  it("is the bearer of CONNECT_TOKEN, and nobody is without it", () => {
    process.env.CONNECT_TOKEN = "connect-secret";
    expect(fromStrut("Bearer connect-secret")).toBe(true);
    for (const h of ["Bearer connect-secreT", "Bearer connect-secret2", "Bearer connect", "bearer connect-secret", "connect-secret", "Bearer ", "", null]) {
      expect(fromStrut(h), String(h)).toBe(false);
    }
    process.env.SHARED_API_TOKEN = "deployment-key";
    expect(fromStrut("Bearer deployment-key")).toBe(false);
    delete process.env.CONNECT_TOKEN;
    expect(fromStrut("Bearer connect-secret")).toBe(false);
    expect(fromStrut("Bearer ")).toBe(false);
  });
});

describe("Continue's origin", () => {
  it("is stadeum's own, never strut's, another box's, another site's or none", () => {
    expect(fromTheBox("https://acme.example.com")).toBe(true);
    for (const origin of ["https://strut.acme.example.com", "https://other.example.com", "https://evil.example", "http://acme.example.com", "null", "", null]) {
      expect(fromTheBox(origin), String(origin)).toBe(false);
    }
  });
});

describe("scopes", () => {
  it("are each one the provider lists, or the ask is refused", () => {
    expect(askedScopes(github(), null)).toEqual([]);
    expect(askedScopes(github(), "")).toEqual([]);
    expect(askedScopes(github(), "repo")).toBeNull();
    expect(askedScopes(slackLike, "chat:write channels:read,chat:write")).toEqual(["chat:write", "channels:read"]);
    expect(askedScopes(slackLike, "chat:write admin")).toBeNull();
  });
});

describe("where a connect starts", () => {
  it("is GitHub's authorize page, back to the box's own callback", () => {
    const url = new URL(startUrl(github(), { state: "s.t", scopes: [], install: false }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "Iv23.client",
      redirect_uri: "https://acme.example.com/api/connect/github/callback",
      state: "s.t",
    });
  });

  it("is GitHub's install page with install, carrying the state alone", () => {
    process.env.CONNECT_GITHUB_SLUG = "stadeum";
    const url = new URL(startUrl(github(), { state: "s.t", scopes: [], install: true }));
    expect(url.toString()).toBe("https://github.com/apps/stadeum/installations/new?state=s.t");
  });

  it("comes back through the bounce when the box has one", () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com/";
    expect(redirectUri("github")).toBe("https://auth.example.com/api/connect/github/callback");
    expect(new URL(startUrl(github(), { state: "acme.s.t", scopes: [], install: false })).searchParams.get("redirect_uri")).toBe(
      "https://auth.example.com/api/connect/github/callback",
    );
  });

  it("puts a provider's fixed extras and the scopes asked for on", () => {
    const url = new URL(startUrl(slackLike, { state: "s.t", scopes: ["chat:write", "search:read"], install: false }));
    expect(url.searchParams.get("scope")).toBe("chat:write search:read");
    expect(url.searchParams.get("team")).toBe("T1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://acme.example.com/api/connect/slack/callback");
  });
});

describe("the secrets in a token response", () => {
  it("are each entry's first path present", () => {
    expect(pickSecrets(github(), { access_token: "ghu_1", token_type: "bearer" })).toEqual({ GITHUB_TOKEN: "ghu_1" });
    expect(pickSecrets(slackLike, { ok: true, access_token: "xoxb-bot", authed_user: { access_token: "xoxp-person" } })).toEqual({ SLACK_TOKEN: "xoxp-person" });
    expect(pickSecrets(slackLike, { ok: true, access_token: "xoxb-bot" })).toEqual({ SLACK_TOKEN: "xoxb-bot" });
  });

  it("are none in an error, an empty value, or something that isn't an object", () => {
    for (const data of [{ error: "bad_verification_code" }, { ok: false, error: "invalid_code" }, { access_token: "" }, { access_token: 7 }, null, "ghu_1", undefined]) {
      expect(pickSecrets(github(), data)).toEqual({});
    }
  });
});
