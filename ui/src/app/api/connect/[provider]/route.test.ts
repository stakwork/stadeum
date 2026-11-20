import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyState } from "@/lib/connect";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";

const who = vi.hoisted(() => ({ user: null as null | { actor: string; role: string } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => who.user }));

const { GET, POST } = await import("./route");

let fake: FakeStack;
const saved = { ...process.env };
const BOX = "https://acme.example.com";

beforeAll(async () => {
  fake = await startFakeStack({ token: "connect-test-token" });
});
afterAll(() => fake.close());
beforeEach(() => {
  Object.assign(process.env, {
    AUTH_SECRET: "test-auth-secret",
    AUTH_URL: BOX,
    STRUT_PUBLIC_URL: "https://strut.acme.example.com",
    CONNECT_GITHUB_CLIENT_ID: fake.state.github.app.clientId,
    CONNECT_GITHUB_CLIENT_SECRET: fake.state.github.app.clientSecret,
    CONNECT_GITHUB_URL: fake.githubUrl,
  });
  who.user = { actor: "ada-c1", role: "member" };
});
afterEach(() => {
  process.env = { ...saved };
});

const ctx = (provider = "github") => ({ params: Promise.resolve({ provider }) });

function open(query: string, headers: Record<string, string> = {}, provider = "github") {
  return GET(new NextRequest(`${BOX}/api/connect/${provider}${query}`, { headers }), ctx(provider));
}

/** The confirm page's Continue: a POST of the same parameters, from `origin`. */
function proceed(query: string, origin: string | null = BOX, provider = "github") {
  return POST(
    new NextRequest(`${BOX}/api/connect/${provider}${query}`, { method: "POST", headers: origin === null ? {} : { origin } }),
    ctx(provider),
  );
}

const stateOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state");

describe("GET /api/connect/:provider", () => {
  it("shows the confirm page with the same parameters, and never sends anyone to the provider, wherever the link was followed from", async () => {
    for (const site of ["cross-site", "same-site", "same-origin", "none", ""]) {
      const res = await open("?for=box&return=%2Fapps&install=1", site ? { "sec-fetch-site": site } : {});
      expect(res.status, site).toBe(303);
      expect(res.headers.get("location")).toBe(`${BOX}/connect/github?for=box&return=%2Fapps&install=1`);
    }
    who.user = null;
    expect((await open("")).headers.get("location")).toBe(`${BOX}/connect/github`);
  });

  it("is a 404 for a provider whose client isn't set, or one the table doesn't have", async () => {
    delete process.env.CONNECT_GITHUB_CLIENT_SECRET;
    expect((await open("")).status).toBe(404);
    process.env.CONNECT_GITHUB_CLIENT_SECRET = "x";
    process.env.CONNECT_SLACK_CLIENT_ID = "s";
    process.env.CONNECT_SLACK_CLIENT_SECRET = "s";
    expect((await open("", {}, "slack")).status).toBe(404);
  });
});

describe("POST /api/connect/:provider: the confirm page's Continue", () => {
  it("sends the person to GitHub's authorize page with a state signed at the click, never cached", async () => {
    const before = Date.now();
    const res = await proceed("?return=/apps/stadeum/github");
    const after = Date.now();
    expect(res.status).toBe(303);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${fake.githubUrl}/login/oauth/authorize`);
    expect(to.searchParams.get("client_id")).toBe(fake.state.github.app.clientId);
    expect(to.searchParams.get("redirect_uri")).toBe(`${BOX}/api/connect/github/callback`);
    const back = verifyState(stateOf(res), { provider: "github", actor: "ada-c1" });
    expect(back.ok && back.state).toMatchObject({ return: `${BOX}/apps/stadeum/github` });
    expect(back.ok && back.state.for).toBeUndefined();
    expect(back.ok && back.state.iat).toBeGreaterThanOrEqual(before);
    expect(back.ok && back.state.iat).toBeLessThanOrEqual(after);
  });

  it("is taken only from the box's own origin: not another box's, strut's, another site's, or none", async () => {
    for (const origin of ["https://other.example.com", "https://strut.acme.example.com", "https://evil.example", "null", null]) {
      const res = await proceed("", origin);
      expect(res.status, String(origin)).toBe(403);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("is a 404 for a provider that isn't available", async () => {
    delete process.env.CONNECT_GITHUB_CLIENT_ID;
    expect((await proceed("")).status).toBe(404);
  });

  it("needs a signed-in person", async () => {
    who.user = null;
    expect((await proceed("")).status).toBe(401);
  });

  it("checks the ask again: the box's only for an admin", async () => {
    const res = await proceed("?for=box");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Only an admin");
    who.user = { actor: "root-a1", role: "admin" };
    const ok = await proceed("?for=box");
    expect(ok.status).toBe(303);
    const back = verifyState(stateOf(ok), { provider: "github", actor: "root-a1" });
    expect(back.ok && back.state.for).toBe("box");
  });

  it("checks the ask again: return on the box's origins, no scope GitHub doesn't list", async () => {
    for (const ret of ["https://evil.example/", "//evil.example/", "https://acme.example.com.evil.example/"]) {
      const res = await proceed(`?return=${encodeURIComponent(ret)}`);
      expect(res.status, ret).toBe(400);
      expect(await res.text()).not.toContain("evil");
    }
    const res = await proceed(`?return=${encodeURIComponent("https://strut.acme.example.com/?app=stadeum/github")}`);
    const back = verifyState(stateOf(res), { provider: "github", actor: "ada-c1" });
    expect(back.ok && back.state.return).toBe("https://strut.acme.example.com/?app=stadeum/github");
    expect((await proceed("?scope=repo")).status).toBe(400);
  });

  it("starts at the install page with install=1, when the App's slug is set", async () => {
    expect((await proceed("?install=1")).status).toBe(400);
    process.env.CONNECT_GITHUB_SLUG = fake.state.github.app.slug;
    const res = await proceed("?install=1");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${fake.githubUrl}/apps/${fake.state.github.app.slug}/installations/new`);
    expect([...to.searchParams.keys()]).toEqual(["state"]);
  });

  it("goes through the bounce when the box has one: its callback, and the box's label on the state", async () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com";
    const res = await proceed("");
    const to = new URL(res.headers.get("location")!);
    expect(to.searchParams.get("redirect_uri")).toBe("https://auth.example.com/api/connect/github/callback");
    expect(stateOf(res)).toMatch(/^acme\.[\w-]+\.[\w-]+$/);
  });
});
