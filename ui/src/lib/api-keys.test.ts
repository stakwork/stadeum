import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { authenticateApiKey, withApiKey } from "@/lib/api-auth";
import { API_KEY_PREFIX, createApiKey, generateApiKey, hashApiKey, listApiKeys, resolveApiKey, revokeApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";

let ada: { id: string };

beforeEach(async () => {
  await db.apiKey.deleteMany();
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  ada = await db.user.create({ data: { email: "ada@acme.test", actor: "ada-k1", role: "admin" } });
});
afterAll(() => db.$disconnect());

const req = (method: string, headers: Record<string, string>) => new Request("http://x/api/v1/members", { method, headers });
const make = async (scope: string) => {
  const made = await createApiKey(ada, { name: "ci", scope });
  if (!made.ok) throw new Error(made.reason);
  return made;
};

describe("generation and hashing", () => {
  it("makes a prefixed, unique, high-entropy key whose hash is its SHA-256", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.key.length).toBeGreaterThan(40);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key.startsWith(a.prefix)).toBe(true);
    expect(a.prefix.length).toBeLessThan(a.key.length / 2);
  });
});

describe("key CRUD", () => {
  it("stores only the hash, lists without secrets, and revokes", async () => {
    const made = await make("read");
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: made.record.id } });
    expect(row.hash).toBe(hashApiKey(made.key));
    expect(JSON.stringify(row)).not.toContain(made.key);
    expect(row.createdById).toBe(ada.id);

    const listed = await listApiKeys();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(made.key);
    expect(JSON.stringify(listed)).not.toContain(row.hash);
    expect(listed[0]).toMatchObject({ name: "ci", scope: "read", lastUsedAt: null });

    expect(await revokeApiKey(made.record.id)).toEqual({ ok: true });
    expect(await revokeApiKey(made.record.id)).toEqual({ ok: false, reason: "not-found" });
    expect(await resolveApiKey(made.key)).toBeNull();
  });

  it("refuses a blank or long name and an unknown scope", async () => {
    expect(await createApiKey(ada, { name: "  ", scope: "read" })).toEqual({ ok: false, reason: "invalid-name" });
    expect(await createApiKey(ada, { name: "x".repeat(61), scope: "read" })).toEqual({ ok: false, reason: "invalid-name" });
    expect(await createApiKey(ada, { name: "ci", scope: "admin" })).toEqual({ ok: false, reason: "invalid-scope" });
  });

  it("goes with the person who made it", async () => {
    await make("read");
    await db.user.delete({ where: { id: ada.id } });
    expect(await db.apiKey.count()).toBe(0);
  });
});

describe("authenticateApiKey", () => {
  it("accepts a bearer key or x-api-key and marks it used", async () => {
    const made = await make("read");
    const viaBearer = await authenticateApiKey(req("GET", { authorization: `Bearer ${made.key}` }));
    expect(viaBearer).toMatchObject({ ok: true, auth: { scope: "read", createdById: ada.id, keyId: made.record.id } });
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: made.record.id } })).lastUsedAt).not.toBeNull();
    expect((await authenticateApiKey(req("GET", { "x-api-key": made.key }))).ok).toBe(true);
  });

  it("answers 401 for no key, a wrong key, and a revoked key", async () => {
    const made = await make("read_write");
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer stk_nope" }, { authorization: "Basic abc" }, { "x-api-key": "junk" }]) {
      const r = await authenticateApiKey(req("GET", headers));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(401);
    }
    await revokeApiKey(made.record.id);
    const r = await authenticateApiKey(req("GET", { authorization: `Bearer ${made.key}` }));
    expect(!r.ok && r.response.status).toBe(401);
  });

  it("rejects a read-only key on mutating methods with 403, and lets safe ones through", async () => {
    const ro = await make("read");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await authenticateApiKey(req(method, { authorization: `Bearer ${ro.key}` }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(403);
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect((await authenticateApiKey(req(method, { authorization: `Bearer ${ro.key}` }))).ok).toBe(true);
    }
    const rw = await make("read_write");
    expect((await authenticateApiKey(req("POST", { authorization: `Bearer ${rw.key}` }))).ok).toBe(true);
  });

  it("withApiKey runs the handler only when authenticated, with no-store", async () => {
    const made = await make("read");
    const handler = withApiKey(async (_r, auth) => Response.json({ scope: auth.scope }));
    expect((await handler(req("GET", {}))).status).toBe(401);
    const ok = await handler(req("GET", { authorization: `Bearer ${made.key}` }));
    expect(await ok.json()).toEqual({ scope: "read" });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await handler(req("POST", { authorization: `Bearer ${made.key}` }))).status).toBe(403);
  });
});
