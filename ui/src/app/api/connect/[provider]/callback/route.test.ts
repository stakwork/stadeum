import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signState } from "@/lib/connect";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";

const who = vi.hoisted(() => ({ user: null as null | { actor: string; role: string } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => who.user }));

const { POST: start } = await import("../route");
const { GET: callback } = await import("./route");

let fake: FakeStack;
const saved = { ...process.env };
const BOX = "https://acme.example.com";
const params = Promise.resolve({ provider: "github" });

beforeAll(async () => {
  fake = await startFakeStack({
    token: "connect-test-token",
    github: { callbackUrl: `${BOX}/api/connect/github/callback` },
    google: { callbackUrl: `${BOX}/api/connect/google/callback` },
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  Object.assign(process.env, {
    AUTH_SECRET: "test-auth-secret",
    AUTH_URL: BOX,
    STRUT_PUBLIC_URL: "https://strut.acme.example.com",
    STRUT_URL: fake.strutUrl,
    SHARED_API_TOKEN: fake.token,
    CONNECT_GITHUB_CLIENT_ID: fake.state.github.app.clientId,
    CONNECT_GITHUB_CLIENT_SECRET: fake.state.github.app.clientSecret,
    CONNECT_GITHUB_SLUG: fake.state.github.app.slug,
    CONNECT_GITHUB_URL: fake.githubUrl,
    CONNECT_GOOGLE_CLIENT_ID: fake.state.google.client.clientId,
    CONNECT_GOOGLE_CLIENT_SECRET: fake.state.google.client.clientSecret,
    CONNECT_GOOGLE_URL: fake.googleUrl,
  });
  who.user = { actor: "ada-c1", role: "member" };
  fake.state.secrets.clear();
  fake.state.secretRefresh.clear();
  fake.state.google.omit = [];
  fake.state.deploymentSecrets.clear();
  fake.state.github.app.callbackUrl = `${BOX}/api/connect/github/callback`;
  fake.state.down.strut = false;
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const unescape = (s: string) => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

/** The confirm page's Continue, then the person clicks the fake GitHub's button: where GitHub sends the browser back. */
async function authorize(query: string, button: "go" | "cancel" = "go"): Promise<URL> {
  const started = await start(new NextRequest(`${BOX}/api/connect/github${query}`, { method: "POST", headers: { origin: BOX } }), { params });
  expect(started.status).toBe(303);
  const page = await (await fetch(started.headers.get("location")!)).text();
  const links = [...page.matchAll(/<a (class="go" )?href="([^"]+)"/g)].map((m) => unescape(m[2]!));
  return new URL(button === "go" ? links[0]! : links[1]!);
}

/** GitHub's redirect, as it lands on the box (through the bounce or not). */
const land = (back: URL) => callback(new NextRequest(`${BOX}${back.pathname}${back.search}`), { params });

const GMAIL = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
const google = Promise.resolve({ provider: "google" });

/** The same for Google, asking for Gmail's two scopes: where Google sends the browser back once the person allows it. */
async function allowGoogle(query = ""): Promise<URL> {
  const ask = `?scope=${encodeURIComponent(GMAIL.join(" "))}${query ? `&${query.slice(1)}` : ""}`;
  const started = await start(new NextRequest(`${BOX}/api/connect/google${ask}`, { method: "POST", headers: { origin: BOX } }), { params: google });
  expect(started.status).toBe(303);
  const page = await (await fetch(started.headers.get("location")!)).text();
  return new URL(unescape(page.match(/<a class="go" href="([^"]+)"/)![1]!));
}

const landGoogle = (back: URL) => callback(new NextRequest(`${BOX}${back.pathname}${back.search}`), { params: google });

describe("GET /api/connect/:provider/callback", () => {
  it("trades the code and gives strut the person's GITHUB_TOKEN, then goes back", async () => {
    const res = await land(await authorize("?return=/apps/stadeum/github"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BOX}/apps/stadeum/github`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...fake.state.secrets]).toEqual([["ada-c1/GITHUB_TOKEN", fake.state.github.tokens.at(-1)]]);
    expect(fake.state.deploymentSecrets.size).toBe(0);
    expect(fake.state.requests).toContain("PUT /strut/actors/ada-c1/secrets/GITHUB_TOKEN");
    // GitHub's tokens never expire: strut gets the value alone.
    expect(fake.state.secretRefresh.size).toBe(0);
  });

  it("gives strut a Google token with its expiry, its refresh token and the provider, so strut can refresh it", async () => {
    const res = await landGoogle(await allowGoogle("?return=/apps"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BOX}/apps`);
    expect([...fake.state.secrets]).toEqual([["ada-c1/GOOGLE_TOKEN", fake.state.google.tokens.at(-1)]]);
    const refresh = fake.state.secretRefresh.get("ada-c1/GOOGLE_TOKEN");
    expect(refresh).toEqual({ expires_in: 3599, refresh_token: expect.stringMatching(/^1\/\//), provider: "google" });
    expect(fake.state.google.refreshTokens.get(refresh!.refresh_token)).toMatchObject({ scope: GMAIL.join(" "), revoked: false });
  });

  it("is a failure when Google gives no refresh token or no expiry, and strut gets nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const left of ["refresh_token", "expires_in"] as const) {
      fake.state.google.omit = [left];
      const res = await landGoogle(await allowGoogle());
      expect(res.status, left).toBe(502);
      expect(await res.text()).toContain(`no ${left}`);
      expect(fake.state.secrets.size).toBe(0);
    }
    const logged = warn.mock.calls.flat().join(" ");
    for (const token of fake.state.google.tokens) expect(logged).not.toContain(token);
  });

  it("gives an admin's token to strut as their own, and a for=box link writes nothing to the deployment", async () => {
    who.user = { actor: "root-a1", role: "admin" };
    const deploymentWrites = () => fake.state.requests.filter((r) => r.startsWith("PUT /strut/secrets/")).length;
    const before = deploymentWrites();
    const res = await land(await authorize("?for=box&return=" + encodeURIComponent("https://strut.acme.example.com/?app=stadeum/github")));
    expect(res.headers.get("location")).toBe("https://strut.acme.example.com/?app=stadeum/github");
    expect([...fake.state.secrets]).toEqual([["root-a1/GITHUB_TOKEN", fake.state.github.tokens.at(-1)]]);
    expect(fake.state.deploymentSecrets.size).toBe(0);
    expect(deploymentWrites()).toBe(before);
  });

  it("takes an install's return as a connect, and ignores its installation_id", async () => {
    const back = await authorize("?install=1");
    expect(back.searchParams.get("installation_id")).toBe("4242");
    const res = await land(back);
    expect(res.headers.get("location")).toBe(`${BOX}/`);
    expect(fake.state.secrets.get("ada-c1/GITHUB_TOKEN")).toBe(fake.state.github.tokens.at(-1));
  });

  it("refuses the same return twice: the code is spent", async () => {
    const back = await authorize("");
    expect((await land(back)).status).toBe(302);
    const first = fake.state.secrets.get("ada-c1/GITHUB_TOKEN");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = await land(back);
    expect(again.status).toBe(502);
    expect(await again.text()).toContain("bad_verification_code");
    expect(fake.state.secrets.get("ada-c1/GITHUB_TOKEN")).toBe(first);
  });

  it("refuses an altered state, another person's, and an expired one, before trading the code", async () => {
    const back = await authorize("");
    const trades = () => fake.state.requests.filter((r) => r === "POST /github/login/oauth/access_token").length;
    const before = trades();
    const state = back.searchParams.get("state")!;
    const altered = new URL(back);
    altered.searchParams.set("state", `${state.slice(0, -3)}AAA`);
    expect((await land(altered)).status).toBe(400);

    who.user = { actor: "bob-c2", role: "member" };
    const res = await land(back);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("someone else");
    who.user = { actor: "ada-c1", role: "member" };

    const old = new URL(back);
    old.searchParams.set("state", signState({ provider: "github", actor: "ada-c1", return: `${BOX}/` }, Date.now() - 61 * 60_000));
    const stale = await land(old);
    expect(stale.status).toBe(400);
    expect(await stale.text()).toContain("more than an hour old");

    const none = new URL(back);
    none.searchParams.delete("state");
    expect((await land(none)).status).toBe(400);

    expect(trades()).toBe(before);
    // The code was never spent: the right person, with the state as it came, still connects.
    expect((await land(back)).status).toBe(302);
    expect(fake.state.secrets.has("ada-c1/GITHUB_TOKEN")).toBe(true);
  });

  it("needs a signed-in person", async () => {
    const back = await authorize("");
    who.user = null;
    expect((await land(back)).status).toBe(401);
  });

  it("says so, with a way back, when the person cancels on GitHub", async () => {
    const res = await land(await authorize("?return=/packages", "cancel"));
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain("access_denied");
    expect(page).toContain(`href="${BOX}/packages"`);
    expect(fake.state.secrets.size).toBe(0);
  });

  it("is a failure when the token URL gives no token, and logs neither the code nor any secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const back = await authorize("");
    process.env.CONNECT_GITHUB_CLIENT_SECRET = "wrong-secret";
    const res = await land(back);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("incorrect_client_credentials");
    expect(fake.state.secrets.size).toBe(0);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("incorrect_client_credentials");
    expect(logged).not.toContain(back.searchParams.get("code")!);
    expect(logged).not.toContain("wrong-secret");
  });

  it("is a failure when strut doesn't keep the token, and never logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const back = await authorize("");
    fake.state.down.strut = true;
    const res = await land(back);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("The token couldn’t be saved");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain(fake.state.github.tokens.at(-1)!);
    expect(logged).not.toContain(back.searchParams.get("code")!);
  });

  it("comes back through the bounce: the bounce's callback, and the label taken off the state", async () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com";
    fake.state.github.app.callbackUrl = "https://auth.example.com/api/connect/github/callback";
    const back = await authorize("?return=/apps");
    expect(back.origin + back.pathname).toBe("https://auth.example.com/api/connect/github/callback");
    expect(back.searchParams.get("state")).toMatch(/^acme\./);
    // The bounce redirects to https://acme.<domain> with the path and query unchanged.
    const res = await land(back);
    expect(res.headers.get("location")).toBe(`${BOX}/apps`);
    expect(fake.state.secrets.get("ada-c1/GITHUB_TOKEN")).toBe(fake.state.github.tokens.at(-1));
  });

  it("is a 404 when the provider's client isn't set", async () => {
    delete process.env.CONNECT_GITHUB_CLIENT_ID;
    expect((await land(new URL(`${BOX}/api/connect/github/callback?code=x&state=y`))).status).toBe(404);
  });
});
