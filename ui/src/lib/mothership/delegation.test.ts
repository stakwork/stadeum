import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admit } from "@/lib/access";
import { db } from "@/lib/db";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { ensureDelegation, isPastHalfLife } from "./delegation";
import { ensureOrgTrust } from "./trust";

let fake: FakeStack;

beforeAll(async () => {
  fake = await startFakeStack();
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    BIFROST_URL: fake.bifrostUrl,
    BIFROST_ADMIN_PASS: "",
    STRUT_URL: fake.strutUrl,
    STADEUM_ORG_SLUG: "acme",
    AUTH_URL: "http://localhost:3000",
  });
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await db.org.deleteMany();
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});

describe("ensureOrgTrust", () => {
  it("registers the org key, sets the realm, seeds agents, then caches", async () => {
    const first = await ensureOrgTrust();
    expect(first.status).toBe("upserted");
    expect(first.orgId).toBe("stadeum_acme");
    expect(fake.state.trust.get("stadeum_acme")?.pubkey).toBe(first.pubkey);
    expect(fake.state.realmId).toBe("acme");
    expect(fake.state.agents).toHaveLength(2);

    expect((await ensureOrgTrust()).status).toBe("cached");
    expect((await ensureOrgTrust({ force: true })).status).toBe("already-registered");
  });

  it("stores the org private key encrypted", async () => {
    const org = await db.org.findUniqueOrThrow({ where: { id: "org" } });
    expect(org.orgPrivkeyEnc).toMatch(/^v1:/);
    // Admin creds came from /_plugin/admin-credentials and are encrypted too.
    expect(org.bifrostAdminPassEnc ?? "").not.toContain(fake.adminPass);
  });
});

describe("ensureDelegation", () => {
  it("first person: customer, VK, mint, push; the fake strut verifies it against the trust registry", async () => {
    const { user } = await admit("ada@acme.test", "Ada");
    expect(user?.role).toBe("admin");
    const r = await ensureDelegation(user!);
    expect(r.status).toBe("pushed");
    expect(r.actor).toBe(user!.actor);

    const held = fake.state.delegations.get(user!.actor);
    expect(held?.baseUrl).toBe(fake.bifrostUrl);
    expect(held?.apiKey).toMatch(/^sk-bf-/);
    expect(fake.state.customers.map((c) => c.name)).toEqual([user!.actor]);

    const row = await db.mothershipUser.findUniqueOrThrow({ where: { userId: user!.id } });
    expect(row.delegationStatus).toBe("pushed");
    expect(row.vkValueEnc).not.toContain(held!.apiKey);
    expect(row.userPrivkeyEnc).toMatch(/^v1:/);
  });

  it("second call is fresh: no new mint", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@acme.test" } });
    const before = fake.state.delegations.get(user.actor)!.delegationId;
    const r = await ensureDelegation(user);
    expect(r.status).toBe("fresh");
    expect(fake.state.delegations.get(user.actor)!.delegationId).toBe(before);
  });

  it("renews past half-life", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@acme.test" } });
    const later = new Date(Date.now() + 31 * 24 * 3600 * 1000);
    const r = await ensureDelegation(user, { now: later });
    expect(r.status).toBe("pushed");
  });

  it("never throws: an unreachable strut is recorded as failed", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@acme.test" } });
    fake.state.down.strut = true;
    try {
      const r = await ensureDelegation(user);
      expect(r.status).toBe("failed");
      const row = await db.mothershipUser.findUniqueOrThrow({ where: { userId: user.id } });
      expect(row.delegationStatus).toBe("failed");
      expect(row.delegationError).toContain("503");
    } finally {
      fake.state.down.strut = false;
    }
  });

  it("not-configured when there is no shared token", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@acme.test" } });
    const saved = process.env.SHARED_API_TOKEN;
    process.env.SHARED_API_TOKEN = "";
    try {
      expect((await ensureDelegation(user)).status).toBe("not-configured");
    } finally {
      process.env.SHARED_API_TOKEN = saved;
    }
  });
});

describe("isPastHalfLife", () => {
  it("is true at 30 days left, false at 31, true for garbage", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const days = (n: number) => new Date(now.getTime() + n * 86400_000).toISOString();
    expect(isPastHalfLife(days(30), now)).toBe(true);
    expect(isPastHalfLife(days(31), now)).toBe(false);
    expect(isPastHalfLife("nope", now)).toBe(true);
  });
});
