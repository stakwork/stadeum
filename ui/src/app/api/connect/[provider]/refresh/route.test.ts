import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startFakeStack, type FakeStack } from "@/test/fake-stack";

import { POST } from "./route";

let fake: FakeStack;
const saved = { ...process.env };
const BOX = "https://acme.example.com";
const CONNECT_TOKEN = "connect-test-secret";
const SEEDED = "1//seeded-refresh-token";

beforeAll(async () => {
  fake = await startFakeStack({ token: "deployment-test-key" });
});
afterAll(() => fake.close());
beforeEach(() => {
  Object.assign(process.env, {
    AUTH_URL: BOX,
    SHARED_API_TOKEN: fake.token,
    CONNECT_TOKEN,
    CONNECT_GITHUB_CLIENT_ID: fake.state.github.app.clientId,
    CONNECT_GITHUB_CLIENT_SECRET: fake.state.github.app.clientSecret,
    CONNECT_GITHUB_URL: fake.githubUrl,
    CONNECT_GOOGLE_CLIENT_ID: fake.state.google.client.clientId,
    CONNECT_GOOGLE_CLIENT_SECRET: fake.state.google.client.clientSecret,
    CONNECT_GOOGLE_URL: fake.googleUrl,
  });
  const g = fake.state.google;
  g.refreshTokens.clear();
  g.refreshTokens.set(SEEDED, { clientId: g.client.clientId, scope: "https://www.googleapis.com/auth/gmail.readonly", revoked: false });
  g.tokens.length = 0;
  g.rotate = false;
  g.down = false;
  g.omit = [];
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

/** Strut's call: its bearer, and a body. */
function refresh(body: unknown = { refresh_token: SEEDED }, { provider = "google", bearer = CONNECT_TOKEN as string | null } = {}) {
  return POST(
    new NextRequest(`http://stadeum-ui:3000/api/connect/${provider}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider }) },
  );
}

const asked = () => fake.state.requests.filter((r) => r === "POST /google/token").length;

describe("POST /api/connect/:provider/refresh", () => {
  it("gives strut, with the right token, a new access token and how long it lasts", async () => {
    const before = asked();
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ access_token: fake.state.google.tokens.at(-1), expires_in: 3599 });
    expect(asked()).toBe(before + 1);
    // Google sends no new refresh token: the one strut holds still works.
    expect(fake.state.google.refreshTokens.get(SEEDED)?.revoked).toBe(false);
  });

  it("passes on a refresh token the provider rotated", async () => {
    fake.state.google.rotate = true;
    const body = (await (await refresh()).json()) as { refresh_token?: string };
    expect(body.refresh_token).toMatch(/^1\/\//);
    expect(body.refresh_token).not.toBe(SEEDED);
    expect(fake.state.google.refreshTokens.get(SEEDED)?.revoked).toBe(true);
    expect((await refresh({ refresh_token: body.refresh_token })).status).toBe(200);
  });

  it("refuses any other bearer with a 401, and never asks the provider", async () => {
    const before = asked();
    for (const bearer of ["wrong", `${CONNECT_TOKEN}x`, CONNECT_TOKEN.slice(0, -1), fake.token, "", null]) {
      const res = await refresh(undefined, { bearer });
      expect(res.status, String(bearer)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(asked()).toBe(before);
  });

  it("is a 404 without CONNECT_TOKEN, and for a provider with no refresh, one not set up, or one not in the table", async () => {
    expect((await refresh(undefined, { provider: "github" })).status).toBe(404);
    expect((await refresh(undefined, { provider: "slack" })).status).toBe(404);
    expect((await refresh(undefined, { provider: "__proto__" })).status).toBe(404);
    delete process.env.CONNECT_GOOGLE_CLIENT_SECRET;
    expect((await refresh()).status).toBe(404);
    process.env.CONNECT_GOOGLE_CLIENT_SECRET = fake.state.google.client.clientSecret;
    delete process.env.CONNECT_TOKEN;
    expect((await refresh()).status).toBe(404);
    expect((await refresh(undefined, { bearer: null })).status).toBe(404);
  });

  it("is a 400 when the provider refuses the refresh token, and only then: strut deletes the secret on it", async () => {
    fake.state.google.refreshTokens.get(SEEDED)!.revoked = true;
    let res = await refresh();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });

    res = await refresh({ refresh_token: "1//never-given" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });

    // A wrong client secret is no reason to drop anyone's token.
    fake.state.google.refreshTokens.get(SEEDED)!.revoked = false;
    process.env.CONNECT_GOOGLE_CLIENT_SECRET = "not-the-secret";
    res = await refresh();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_client" });
  });

  it("is a 422 without a refresh token, never a 400, and never asks the provider", async () => {
    const before = asked();
    for (const body of [{}, { refresh_token: "" }, { refresh_token: 7 }, "not json", "null"]) {
      const res = await refresh(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toEqual({ error: "refresh_token is required" });
    }
    expect(asked()).toBe(before);
  });

  it("is a 502 when the provider doesn't answer, or answers with no token or no lifetime", async () => {
    fake.state.google.down = true;
    let res = await refresh();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "HTTP 503" });
    fake.state.google.down = false;

    fake.state.google.omit = ["expires_in"];
    res = await refresh();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "no expires_in" });
    fake.state.google.omit = [];

    // Nobody listening where the provider should be.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    process.env.CONNECT_GOOGLE_URL = `http://127.0.0.1:${port}/google`;
    res = await refresh();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "the provider did not answer" });
  });

  it("logs nothing, whatever happens", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await refresh();
    await refresh({ refresh_token: "1//never-given" });
    await refresh(undefined, { bearer: "wrong" });
    fake.state.google.down = true;
    await refresh();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
