import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readCallAnswer } from "@/lib/calls";
import { DEV_LIVEKIT, startFakeStack, type FakeStack } from "@/test/fake-stack";

const who = vi.hoisted(() => ({ user: null as null | { actor: string } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => who.user }));

const { POST } = await import("./route");

let fake: FakeStack;
const saved = { ...process.env };
const KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(async () => {
  fake = await startFakeStack({ token: "calls-test-token" });
});
afterAll(() => fake.close());
beforeEach(() => {
  Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
  who.user = { actor: "ada-c1" };
  fake.state.voice = { livekit: DEV_LIVEKIT, refuse: null, forward: null, calls: [] };
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

function call(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://acme.example/api/calls", {
      method: "POST",
      headers: { host: "acme.example", origin: "https://acme.example", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/calls", () => {
  it("starts a call as the person through strut, and answers the room to join, never cached", async () => {
    const res = await call({ key: KEY, voice: "am_michael" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const read = readCallAnswer(await res.json());
    expect(read.ok && read.answer.voice).toBe("am_michael");
    expect(fake.state.voice.calls).toEqual([{ actor: "ada-c1", room: read.ok ? read.answer.room : "" }]);
    expect(fake.state.requests).toContain("POST /strut/voice/calls");
  });

  it("needs a signed-in person", async () => {
    who.user = null;
    expect((await call({ key: KEY })).status).toBe(401);
    expect(fake.state.voice.calls).toEqual([]);
  });

  it("starts only from stadeum's own pages: a page of strut's subdomain is the same site, not the same origin", async () => {
    expect((await call({ key: KEY }, { origin: "https://strut.acme.example" })).status).toBe(403);
    expect((await call({ key: KEY }, { origin: "" })).status).toBe(403);
    expect((await call(JSON.stringify({ key: KEY }), { "content-type": "text/plain" })).status).toBe(415);
    expect(fake.state.voice.calls).toEqual([]);
  });

  it("never makes a call without a key, and checks what it hands on", async () => {
    for (const body of [{}, { key: "short" }, { key: KEY, voice: "../x" }, { key: KEY, artifacts: "yes" }, "not json"]) {
      expect((await call(body)).status).toBe(400);
    }
    expect((await call({ key: KEY, pad: "x".repeat(17 * 1024) })).status).toBe(413);
    expect(fake.state.voice.calls).toEqual([]);
  });

  it("passes a 402 and a 503 on as strut gave them, for the page to say", async () => {
    fake.state.voice.refuse = { status: 402, body: { error: "below the minimum", balance: 10, minimum: 500 } };
    let res = await call({ key: KEY });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "below the minimum", balance: 10, minimum: 500 });

    fake.state.voice.refuse = null;
    fake.state.voice.livekit = null;
    res = await call({ key: KEY });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/no voice service/);
  });

  it("reaches the voice service as strut hands it on: the person, the shared secret, the body unchanged (the fake's forward)", async () => {
    const { createServer } = await import("node:http");
    const seen: Array<{ actor?: string; auth?: string; body: string }> = [];
    const voice = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ actor: req.headers["x-strut-actor"] as string, auth: req.headers.authorization, body });
        res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ error: "top up", balance: 0, minimum: 100 }));
      });
    });
    await new Promise<void>((r) => voice.listen(0, "127.0.0.1", r));
    const { port } = voice.address() as { port: number };
    fake.state.voice.forward = { url: `http://127.0.0.1:${port}`, token: "voice-secret" };
    try {
      const res = await call({ key: KEY, voice: "af_heart", artifacts: true });
      expect(res.status).toBe(402);
      expect(seen).toEqual([{ actor: "ada-c1", auth: "Bearer voice-secret", body: JSON.stringify({ key: KEY, voice: "af_heart", artifacts: true }) }]);
    } finally {
      voice.close();
    }
  });

  it("is a 503 when strut does not answer, and logs neither the key nor the answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.STRUT_URL = "http://127.0.0.1:9/strut";
    const res = await call({ key: KEY });
    expect(res.status).toBe(503);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
  });

  it("makes a refusal that is the box's to fix a 502", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SHARED_API_TOKEN = "wrong";
    const res = await call({ key: KEY });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/strut answered 401/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ada-c1"));
  });
});
