import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/access";
import { hashApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";

const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const { create, revoke } = await import("./actions");

beforeEach(async () => {
  process.env.STADEUM_ALLOWED_DOMAINS = "acme.test";
  await db.apiKey.deleteMany();
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await admit("ada@acme.test"); // admin
  await admit("ben@acme.test"); // member
  who.email = "ada@acme.test";
});
afterAll(() => db.$disconnect());

const form = (o: Record<string, string>) => Object.entries(o).reduce((f, [k, v]) => (f.set(k, v), f), new FormData());

describe("API key actions", () => {
  it("an admin creates a key, shown once, stored hashed, owned by them", async () => {
    const state = await create({}, form({ name: "ci", scope: "read_write" }));
    expect(state.created?.key.startsWith("stk_")).toBe(true);
    const row = await db.apiKey.findFirstOrThrow({ include: { createdBy: true } });
    expect(row.hash).toBe(hashApiKey(state.created!.key));
    expect(row).toMatchObject({ name: "ci", scope: "read_write" });
    expect(row.createdBy.email).toBe("ada@acme.test");
  });

  it("explains a bad name or scope", async () => {
    expect((await create({}, form({ name: "", scope: "read" }))).error).toMatch(/name/);
    expect((await create({}, form({ name: "ci", scope: "root" }))).error).toMatch(/scope/);
    expect(await db.apiKey.count()).toBe(0);
  });

  it("revokes a key", async () => {
    const { created } = await create({}, form({ name: "ci", scope: "read" }));
    const row = await db.apiKey.findFirstOrThrow({ where: { hash: hashApiKey(created!.key) } });
    await revoke(form({ id: row.id }));
    expect(await db.apiKey.count()).toBe(0);
  });

  it("is for admins: a member is sent home and nothing changes", async () => {
    who.email = "ben@acme.test";
    await expect(create({}, form({ name: "ci", scope: "read" }))).rejects.toThrow("redirect:/");
    await expect(revoke(form({ id: "x" }))).rejects.toThrow("redirect:/");
    expect(await db.apiKey.count()).toBe(0);
  });
});
