import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyState } from "@/lib/connect";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";

const who = vi.hoisted(() => ({ user: null as null | { actor: string; role: string } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => who.user }));

const { GET } = await import("./route");

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "connect-test-token" });
});
afterAll(() => fake.close());
beforeEach(() => {
  Object.assign(process.env, {
    AUTH_SECRET: "test-auth-secret",
    AUTH_URL: "https://acme.example.com",
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

function start(query: string, headers: Record<string, string> = {}, provider = "github") {
  return GET(new NextRequest(`https://acme.example.com/api/connect/${provider}${query}`, { headers }), { params: Promise.resolve({ provider }) });
}

const stateOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state");

describe("GET /api/connect/:provider", () => {
  it("sends a signed-in person to GitHub's authorize page with a state signed for them, never cached", async () => {
    const res = await start("?return=/apps/stadeum/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${fake.githubUrl}/login/oauth/authorize`);
    expect(to.searchParams.get("client_id")).toBe(fake.state.github.app.clientId);
    expect(to.searchParams.get("redirect_uri")).toBe("https://acme.example.com/api/connect/github/callback");
    const back = verifyState(stateOf(res), { provider: "github", actor: "ada-c1" });
    expect(back.ok && back.state).toMatchObject({ return: "https://acme.example.com/apps/stadeum/github" });
    expect(back.ok && back.state.for).toBeUndefined();
  });

  it("is a 404 for a provider whose client isn't set, or one the table doesn't have", async () => {
    delete process.env.CONNECT_GITHUB_CLIENT_SECRET;
    expect((await start("")).status).toBe(404);
    process.env.CONNECT_GITHUB_CLIENT_SECRET = "x";
    process.env.CONNECT_SLACK_CLIENT_ID = "s";
    process.env.CONNECT_SLACK_CLIENT_SECRET = "s";
    expect((await start("", {}, "slack")).status).toBe(404);
  });

  it("needs a signed-in person", async () => {
    who.user = null;
    expect((await start("")).status).toBe(401);
  });

  it("refuses a start from another site, and takes one from strut's pages or the address bar", async () => {
    expect((await start("", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    for (const site of ["same-site", "same-origin", "none"]) expect((await start("", { "sec-fetch-site": site })).status).toBe(302);
  });

  it("comes back only to the box's own origins", async () => {
    for (const ret of ["https://evil.example/", "//evil.example/", "https://acme.example.com.evil.example/"]) {
      const res = await start(`?return=${encodeURIComponent(ret)}`);
      expect(res.status, ret).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).not.toContain("evil");
    }
    const res = await start(`?return=${encodeURIComponent("https://strut.acme.example.com/?app=stadeum/github")}`);
    const back = verifyState(stateOf(res), { provider: "github", actor: "ada-c1" });
    expect(back.ok && back.state.return).toBe("https://strut.acme.example.com/?app=stadeum/github");
  });

  it("refuses a scope the provider doesn't list", async () => {
    const res = await start("?scope=repo");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("takes no scope");
  });

  it("starts for the box only for an admin", async () => {
    let res = await start("?for=box");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Only an admin");
    expect((await start("?for=me")).status).toBe(400);
    who.user = { actor: "root-a1", role: "admin" };
    res = await start("?for=box");
    expect(res.status).toBe(302);
    const back = verifyState(stateOf(res), { provider: "github", actor: "root-a1" });
    expect(back.ok && back.state.for).toBe("box");
  });

  it("starts at the install page with install=1, when the App's slug is set", async () => {
    expect((await start("?install=1")).status).toBe(400);
    process.env.CONNECT_GITHUB_SLUG = fake.state.github.app.slug;
    const res = await start("?install=1");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${fake.githubUrl}/apps/${fake.state.github.app.slug}/installations/new`);
    expect([...to.searchParams.keys()]).toEqual(["state"]);
  });

  it("goes through the bounce when the box has one: its callback, and the box's label on the state", async () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com";
    const res = await start("");
    const to = new URL(res.headers.get("location")!);
    expect(to.searchParams.get("redirect_uri")).toBe("https://auth.example.com/api/connect/github/callback");
    expect(stateOf(res)).toMatch(/^acme\.[\w-]+\.[\w-]+$/);
  });
});
