import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startFakeStack, verifyJwt, type FakeStack } from "@/test/fake-stack";
import { mintEmbedUrl, StrutUnavailableError } from "./client";

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "embed-test-token" });
});
afterAll(() => fake.close());
afterEach(() => {
  process.env = { ...saved };
});

function configure(over: Record<string, string | undefined> = {}) {
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    MCP_URL: fake.mcpUrl,
    MCP_PUBLIC_URL: "https://repo2graph.acme.example/",
    AUTH_URL: "https://acme.example/some/path",
  });
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("mintEmbedUrl", () => {
  it("builds {public mcp}/lab/ with a per-person key, our origin and the deep link", async () => {
    configure();
    const { url, expiresIn } = await mintEmbedUrl("ada-0f3c", {
      wf: "chat",
      run: "r1",
    });
    const u = new URL(url);
    expect(u.origin).toBe("https://repo2graph.acme.example");
    expect(u.pathname).toBe("/lab/");
    expect(u.searchParams.get("embed_origin")).toBe("https://acme.example");
    expect(u.searchParams.get("wf")).toBe("chat");
    expect(u.searchParams.get("run")).toBe("r1");
    expect(expiresIn).toBe("1h");

    const key = u.searchParams.get("key")!;
    expect(verifyJwt(key, fake.token)?.sub).toBe("ada-0f3c");
    expect(url).not.toContain(fake.token);
    expect(fake.state.requests).toContain("POST /mcp/mint-token");
  });

  it("leaves out an empty deep link, and falls back to MCP_URL without a public URL", async () => {
    configure({ MCP_PUBLIC_URL: undefined });
    const u = new URL((await mintEmbedUrl("ada-0f3c")).url);
    expect(`${u.origin}${u.pathname}`).toBe(`${fake.mcpUrl}/lab/`);
    expect(u.searchParams.has("wf")).toBe(false);
    expect(u.searchParams.has("run")).toBe(false);
  });

  it("refuses without the shared token, and when mcp rejects it", async () => {
    configure({ SHARED_API_TOKEN: undefined });
    await expect(mintEmbedUrl("ada-0f3c")).rejects.toBeInstanceOf(
      StrutUnavailableError,
    );
    configure({ SHARED_API_TOKEN: "wrong" });
    await expect(mintEmbedUrl("ada-0f3c")).rejects.toThrow("(401)");
  });

  it("refuses when mcp is down", async () => {
    configure();
    fake.state.down.mcp = true;
    try {
      await expect(mintEmbedUrl("ada-0f3c")).rejects.toThrow("(503)");
    } finally {
      fake.state.down.mcp = false;
    }
  });
});
