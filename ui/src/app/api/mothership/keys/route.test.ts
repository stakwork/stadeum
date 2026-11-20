import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sweepGrantKeys } from "@/lib/mothership/grant-key";
import { ensureVirtualKey } from "@/lib/mothership/virtual-key";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { DELETE } from "./[id]/route";
import { POST } from "./route";

let fake: FakeStack;
const ADA = { email: "ada@acme.test", actor: "ada-k1" };
const MACAROON = "eyJ2IjoxLCJvcmdfaWQiOiJzdGFkZXVtX2FjbWUifQ";
const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

beforeAll(async () => {
  fake = await startFakeStack();
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    BIFROST_URL: fake.bifrostUrl,
    BIFROST_ADMIN_PASS: fake.adminPass,
    AUTH_URL: "https://acme.example",
  });
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await db.user.create({ data: ADA });
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});
beforeEach(() => {
  fake.state.down.bifrost = false;
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://stadeum-ui:3000/api/mothership/keys", {
      method: "POST",
      headers: { authorization: `Bearer ${fake.token}`, "x-strut-actor": ADA.actor, "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function del(id: string, headers: Record<string, string> = { authorization: `Bearer ${fake.token}` }) {
  return DELETE(new Request(`http://stadeum-ui:3000/api/mothership/keys/${id}`, { method: "DELETE", headers }), {
    params: Promise.resolve({ id }),
  });
}

const grant = (over: Record<string, unknown> = {}) => ({ name: "job-42", macaroon: MACAROON, max_cost_usd: 10, expires_at: inHours(8), ...over });
const grantKeys = () => fake.state.vks.filter((v) => v.name.startsWith("grant:"));

describe("POST /api/mothership/keys", () => {
  it("makes a key under the person's customer, capped and expiring as asked, and answers it joined to the macaroon with the route's address", async () => {
    const asked = inHours(8);
    const res = await post(grant({ expires_at: asked, max_cost_usd: 2.5 }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();

    const vk = fake.state.vks.find((v) => v.id === body.id)!;
    const own = fake.state.vks.find((v) => v.name === ADA.actor)!;
    expect(vk.name).toMatch(/^grant:job-42:[0-9a-f]{8}$/);
    expect(vk.customer_id).toBe(own.customer_id);
    expect(fake.state.customers.find((c) => c.id === vk.customer_id)?.name).toBe(ADA.actor);
    // What the person's own key may call, no more.
    const calls = (configs: unknown[]) => (configs as Array<{ provider: string; allowed_models: string[] }>).map((pc) => [pc.provider, pc.allowed_models]);
    expect(calls(vk.provider_configs)).toEqual(calls(own.provider_configs));
    expect(vk.expires_at).toBe(new Date(asked).toISOString());
    // Its own budget, over a period longer than it lives: it never refills.
    expect(vk.budgets).toEqual([{ max_limit: 2.5, reset_duration: "1w" }]);
    expect(body).toEqual({ id: vk.id, key: `${vk.value}.${MACAROON}`, address: "https://mothership.acme.example", expires_at: vk.expires_at });
    // The gateway splits at the first dot: the key's own part has none.
    expect(body.key.split(".")[0]).toBe(vk.value);
  });

  it("gives every grant a key of its own, even under the same name", async () => {
    const a = await (await post(grant({ name: "same" }))).json();
    const b = await (await post(grant({ name: "same" }))).json();
    expect(a.id).not.toBe(b.id);
    expect(a.key).not.toBe(b.key);
  });

  it("needs the deployment key, and makes nothing without it", async () => {
    const before = grantKeys().length;
    expect((await post(grant(), { authorization: "" })).status).toBe(401);
    expect((await post(grant(), { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(grant(), { authorization: fake.token })).status).toBe(401);
    expect(grantKeys()).toHaveLength(before);
  });

  it("refuses what it cannot make, and says why", async () => {
    const before = grantKeys().length;
    const refused = async (body: unknown, headers?: Record<string, string>) => {
      const res = await post(body, headers);
      return [res.status, (await res.json()).error];
    };
    expect(await refused(grant(), { "x-strut-actor": "" })).toEqual([400, expect.stringContaining("x-strut-actor")]);
    expect(await refused(grant({ name: "" }))).toEqual([400, expect.stringContaining("name")]);
    expect(await refused(grant({ name: "a b" }))).toEqual([400, expect.stringContaining("name")]);
    expect(await refused(grant({ name: "x".repeat(65) }))).toEqual([400, expect.stringContaining("name")]);
    expect(await refused(grant({ macaroon: "abc.def" }))).toEqual([400, expect.stringContaining("macaroon")]);
    expect(await refused(grant({ macaroon: "abc=" }))).toEqual([400, expect.stringContaining("macaroon")]);
    expect(await refused(grant({ macaroon: undefined }))).toEqual([400, expect.anything()]);
    expect(await refused(grant({ max_cost_usd: undefined }))).toEqual([400, expect.stringContaining("max_cost_usd")]);
    expect(await refused(grant({ max_cost_usd: 0 }))).toEqual([400, expect.stringContaining("max_cost_usd")]);
    expect(await refused(grant({ max_cost_usd: "10" }))).toEqual([400, expect.stringContaining("max_cost_usd")]);
    expect(await refused(grant({ expires_at: "tomorrow" }))).toEqual([400, expect.stringContaining("expires_at")]);
    expect(await refused(grant({ expires_at: inHours(-1) }))).toEqual([400, "expires_at: must be in the future"]);
    expect(await refused(grant({ expires_at: inHours(25) }))).toEqual([400, "expires_at: at most 24 hours away"]);
    expect(await refused("not json")).toEqual([400, expect.anything()]);
    expect(await refused(grant(), { "x-strut-actor": "nobody-1" })).toEqual([404, "no person with that actor"]);
    expect(grantKeys()).toHaveLength(before);
  });

  it("answers 502 when the gateway is down", async () => {
    fake.state.down.bifrost = true;
    const res = await post(grant());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/^the gateway: /);
  });
});

describe("DELETE /api/mothership/keys/:id", () => {
  it("deletes a grant's key, once", async () => {
    const { id } = await (await post(grant())).json();
    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(fake.state.vks.some((v) => v.id === id)).toBe(false);
    expect((await del(id)).status).toBe(404);
  });

  it("needs the deployment key, and nothing else", async () => {
    const { id } = await (await post(grant())).json();
    expect((await del(id, {})).status).toBe(401);
    expect((await del(id, { authorization: "Bearer wrong" })).status).toBe(401);
    expect(fake.state.vks.some((v) => v.id === id)).toBe(true);
    expect((await del(id)).status).toBe(200);
  });

  it("never deletes a key that is not a grant's: the person's own is a 404", async () => {
    const own = await ensureVirtualKey(await db.user.findUniqueOrThrow({ where: { actor: ADA.actor } }));
    expect((await del(own.vkId)).status).toBe(404);
    expect(fake.state.vks.some((v) => v.id === own.vkId)).toBe(true);
  });
});

describe("sweepGrantKeys", () => {
  it("deletes grants' keys past their expiry, across pages, and nothing else", async () => {
    const live = await (await post(grant({ name: "live", expires_at: inHours(20) }))).json();
    const soon = await (await post(grant({ name: "soon", expires_at: inHours(1) }))).json();
    // Keys the gateway already refuses: more than one page of them.
    const past = new Date(Date.now() - HOUR).toISOString();
    const customer = fake.state.vks.find((v) => v.name === ADA.actor)!.customer_id;
    for (let i = 0; i < 130; i++) {
      fake.state.vks.push({ id: `old-${i}`, name: `grant:old:${i}`, value: `sk-bf-old-${i}`, customer_id: customer, created_at: past, expires_at: past, provider_configs: [] });
    }
    // A person whose actor starts like a grant's key, with a key that expired: not a grant's.
    fake.state.vks.push({ id: "grant-smith", name: "grant-smith-9", value: "sk-bf-gs", customer_id: "c9", created_at: past, expires_at: past, provider_configs: [] });

    expect(await sweepGrantKeys(new Date(Date.now() + 2 * HOUR))).toBeGreaterThanOrEqual(131);
    const ids = new Set(fake.state.vks.map((v) => v.id));
    expect(ids.has(live.id)).toBe(true);
    expect(ids.has(soon.id)).toBe(false);
    expect([...ids].some((id) => id.startsWith("old-"))).toBe(false);
    expect(ids.has("grant-smith")).toBe(true);
    expect(fake.state.vks.some((v) => v.name === ADA.actor)).toBe(true);
  });
});

describe("the route's address", () => {
  it("is mothership. on stadeum-ui's own host, with its scheme and port", () => {
    const saved = process.env.AUTH_URL;
    try {
      process.env.AUTH_URL = "http://stadeum.localhost";
      expect(env.mothershipUrl()).toBe("http://mothership.stadeum.localhost");
      process.env.AUTH_URL = "https://box.example.com:8443/";
      expect(env.mothershipUrl()).toBe("https://mothership.box.example.com:8443");
    } finally {
      process.env.AUTH_URL = saved;
    }
  });
});
