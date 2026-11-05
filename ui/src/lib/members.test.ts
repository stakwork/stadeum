import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { admit } from "./access";
import { db } from "./db";
import { removeUser, setRole } from "./members";

beforeEach(async () => {
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  process.env.STADEUM_ALLOWED_DOMAINS = "acme.test";
});
afterAll(() => db.$disconnect());

const person = async (email: string) => (await admit(email)).user!;
const roleOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).role;

describe("setRole", () => {
  it("promotes and demotes someone else", async () => {
    const ada = await person("ada@acme.test");
    const ben = await person("ben@acme.test");
    expect(await setRole(ada, ben.id, "admin")).toEqual({ ok: true });
    expect(await roleOf(ben.id)).toBe("admin");
    expect(await setRole(ada, ben.id, "member")).toEqual({ ok: true });
    expect(await roleOf(ben.id)).toBe("member");
  });

  it("refuses your own role", async () => {
    const ada = await person("ada@acme.test");
    expect(await setRole(ada, ada.id, "member")).toEqual({ ok: false, reason: "self" });
    expect(await roleOf(ada.id)).toBe("admin");
  });

  it("never demotes the last admin", async () => {
    const ada = await person("ada@acme.test");
    const ben = await person("ben@acme.test");
    // Ben is a member acting on stale state; Ada is the only admin.
    expect(await setRole(ben, ada.id, "member")).toEqual({ ok: false, reason: "last-admin" });
    expect(await roleOf(ada.id)).toBe("admin");
  });
});

describe("removeUser", () => {
  it("removes someone else and their invite", async () => {
    const ada = await person("ada@acme.test");
    const ben = await person("ben@acme.test");
    await db.invite.create({ data: { email: ben.email, role: "member" } });
    const res = await removeUser(ada, ben.id);
    expect(res.ok).toBe(true);
    expect(res.user?.email).toBe(ben.email);
    expect(await db.user.findUnique({ where: { id: ben.id } })).toBeNull();
    expect(await db.invite.count({ where: { email: ben.email } })).toBe(0);
  });

  it("refuses yourself and the last admin", async () => {
    const ada = await person("ada@acme.test");
    const ben = await person("ben@acme.test");
    expect(await removeUser(ada, ada.id)).toEqual({ ok: false, reason: "self" });
    expect(await removeUser(ben, ada.id)).toEqual({ ok: false, reason: "last-admin" });
    expect(await db.user.count()).toBe(2);
  });

  it("removes an admin while another admin remains", async () => {
    const ada = await person("ada@acme.test");
    const ben = await person("ben@acme.test");
    await setRole(ada, ben.id, "admin");
    expect((await removeUser(ada, ben.id)).ok).toBe(true);
  });
});
