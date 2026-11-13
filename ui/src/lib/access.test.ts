import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { admit } from "./access";
import { db } from "./db";

beforeEach(async () => {
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  process.env.STADEUM_ALLOWED_DOMAINS = "";
  process.env.STADEUM_ADMIN_EMAIL = "";
});
afterAll(() => db.$disconnect());

describe("admit", () => {
  it("first person becomes admin; a stranger is refused", async () => {
    expect((await admit("Ada@Acme.test")).user?.role).toBe("admin");
    expect((await admit("eve@elsewhere.com")).user).toBeNull();
  });

  it("an invite admits with its role and is marked accepted", async () => {
    await admit("ada@acme.test");
    await db.invite.create({ data: { email: "ben@acme.test", role: "admin" } });
    const { user } = await admit("BEN@acme.test");
    expect(user?.role).toBe("admin");
    expect((await db.invite.findUniqueOrThrow({ where: { email: "ben@acme.test" } })).acceptedAt).not.toBeNull();
  });

  it("an invite's member role sticks; an unknown role admits as member", async () => {
    await admit("ada@acme.test");
    await db.invite.create({ data: { email: "mo@acme.test", role: "member" } });
    expect((await admit("mo@acme.test")).user?.role).toBe("member");
    await db.invite.create({ data: { email: "old@acme.test", role: "developer" } });
    expect((await admit("old@acme.test")).user?.role).toBe("member");
  });

  it("an allowlisted domain admits as member", async () => {
    await admit("ada@acme.test");
    process.env.STADEUM_ALLOWED_DOMAINS = "acme.test, @partners.acme.test";
    expect((await admit("cal@acme.test")).user?.role).toBe("member");
    expect((await admit("dee@partners.acme.test")).user?.role).toBe("member");
    expect((await admit("eve@notacme.test")).user).toBeNull();
  });

  it("returning people keep their role and actor", async () => {
    const first = (await admit("ada@acme.test")).user!;
    const again = (await admit("ada@acme.test")).user!;
    expect(again.actor).toBe(first.actor);
    expect(again.role).toBe("admin");
  });

  describe("a first admin named at install", () => {
    beforeEach(() => {
      process.env.STADEUM_ADMIN_EMAIL = " Ada@Acme.test ";
    });

    it("a stranger who arrives first is refused, and the named person becomes admin", async () => {
      expect((await admit("eve@elsewhere.com")).user).toBeNull();
      expect((await admit("ada@acme.test")).user?.role).toBe("admin");
    });

    it("an allowlisted person who arrives first is a member, not admin", async () => {
      process.env.STADEUM_ALLOWED_DOMAINS = "acme.test";
      expect((await admit("cal@acme.test")).user?.role).toBe("member");
      expect((await admit("ADA@acme.test")).user?.role).toBe("admin");
    });

    it("the name makes no admin once the box has one", async () => {
      await db.user.create({ data: { id: "u1", email: "ben@acme.test", role: "admin", actor: "a1" } });
      expect((await admit("ada@acme.test")).user).toBeNull();
    });
  });

  it("only one admin when two people sign in at once", async () => {
    const [a, b] = await Promise.all([admit("ada@acme.test"), admit("ben@acme.test")]);
    const roles = [a.user?.role, b.user?.role];
    expect(roles.filter((r) => r === "admin")).toHaveLength(1);
  });
});
