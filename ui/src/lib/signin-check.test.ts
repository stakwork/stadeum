import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

import { admit } from "./access";
import { db } from "./db";
import { checkSignIn } from "./signin-check";

vi.mock("./access", async (orig) => {
  const real = await orig<typeof import("./access")>();
  return { ...real, admit: vi.fn(real.admit) };
});

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
const logged = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

beforeEach(async () => {
  set.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  process.env.STADEUM_ALLOWED_DOMAINS = "";
  process.env.STADEUM_ADMIN_EMAIL = "";
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

describe("checkSignIn", () => {
  it("lets an admitted person in and normalises their email", async () => {
    const user = { email: "Ada@Acme.test", name: "Ada" };
    expect(await checkSignIn(user, "Ada@Acme.test", "google")).toBe(true);
    expect(user.email).toBe("ada@acme.test");
    expect(set).not.toHaveBeenCalled();
  });

  it("redirects an uninvited person, logging and remembering only the masked email", async () => {
    await admit("ada@acme.test");
    const res = await checkSignIn({}, "eve@elsewhere.com", "google");
    expect(res).toBe("/signin?error=NotInvited");
    expect(logged()).toContain("e***e@elsewhere.com");
    expect(logged()).toContain("not-invited");
    expect(logged()).toContain("google");
    expect(logged()).not.toContain("eve@elsewhere.com");
    expect(set).toHaveBeenCalledWith(
      "stadeum.signin.rejected",
      "e***e@elsewhere.com",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 600 }),
    );
  });

  it("logs an invalid email's reason", async () => {
    expect(await checkSignIn({}, "bad@nodot", "google")).toBe("/signin?error=NotInvited");
    expect(logged()).toContain("invalid-email");
    expect(logged()).not.toContain("bad@nodot");
  });

  it("returns SignInFailed and logs when admit throws", async () => {
    vi.mocked(admit).mockRejectedValueOnce(new Error("db down"));
    expect(await checkSignIn({}, "eve@elsewhere.com", "google")).toBe("/signin?error=SignInFailed");
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("db down");
    expect(logged()).not.toContain("eve@elsewhere.com");
  });

  it("returns NoEmail and logs it", async () => {
    expect(await checkSignIn({}, null, "google")).toBe("/signin?error=NoEmail");
    expect(logged()).toContain("no-email");
  });
});
