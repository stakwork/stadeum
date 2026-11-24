import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/access";
import { adminApps, listApps, railApps } from "@/lib/apps";
import { db } from "@/lib/db";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";

// Who is signed in: the real role check runs (lib/session.ts) on the person this email names.
const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { pin } = await import("./actions");

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "apps-actions-test-token" });
});
afterAll(async () => {
  process.env = { ...saved };
  await fake.close();
  await db.$disconnect();
});
beforeEach(async () => {
  Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl, STADEUM_ALLOWED_DOMAINS: "acme.test" });
  await db.org.deleteMany();
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await admit("ada@acme.test"); // the first person: an admin
  await admit("ben@acme.test"); // a member
  who.email = "ada@acme.test";
  fake.state.apps = fake.state.apps.filter((a) => a.name.startsWith("strut/"));
  fake.state.requests = [];
});

/** The rail as the layout builds it for the person signed in. */
async function rail(role: "admin" | "member") {
  const r = railApps((await listApps()) ?? [], await adminApps(role));
  return { apps: r.apps.map((a) => a.name) };
}

describe("pin", () => {
  it("puts a new app in everyone's rail, and an admin takes it out and back without asking strut", async () => {
    fake.publish("stadeum/code/code", "Code");
    expect(await rail("member")).toEqual({ apps: ["strut/jamie", "stadeum/code/code"] });

    expect(await pin("stadeum/code/code", false)).toEqual({});
    // Out of the rail; an admin still opens it from the Apps page.
    expect(await rail("member")).toEqual({ apps: ["strut/jamie"] });
    expect(await rail("admin")).toEqual({ apps: ["strut/jamie", "strut/earnings"] });

    expect(await pin("stadeum/code/code", true)).toEqual({});
    expect(await rail("member")).toEqual({ apps: ["strut/jamie", "stadeum/code/code"] });
    // Strut's pin holds a version: stadeum's never reaches it.
    expect(fake.state.requests.filter((r) => r.startsWith("PUT "))).toEqual([]);
  });

  it("takes an admin-only app out of an admin's rail", async () => {
    expect(await pin("strut/earnings", false)).toEqual({});
    expect(await rail("admin")).toEqual({ apps: ["strut/jamie"] });
  });

  it("never unpins the assistant, which is the home, or strut's component library", async () => {
    expect(await pin("strut/jamie", false)).toEqual({ error: "That change isn’t allowed." });
    expect(await pin("strut/views", false)).toEqual({ error: "That change isn’t allowed." });
    expect((await db.org.findUnique({ where: { id: "org" } }))?.unpinnedApps ?? null).toBeNull();
  });

  it("is an admin's: a member is sent home", async () => {
    who.email = "ben@acme.test";
    await expect(pin("strut/earnings", false)).rejects.toEqual(expect.objectContaining({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/;/) }));
  });
});
