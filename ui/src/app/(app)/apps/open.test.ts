import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/access";
import { setAppPinned } from "@/lib/app-pins";
import { db } from "@/lib/db";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";

// Who is signed in: the real role check runs (lib/session.ts) on the person this email names.
const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));

const { appPage } = await import("./open");

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "apps-open-test-token" });
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
  who.email = "ben@acme.test";
  fake.state.apps = fake.state.apps.filter((a) => a.name.startsWith("strut/"));
});

// What a framed app's `strut:open` takes the person to (strut-frame.tsx).
describe("appPage", () => {
  it("opens the assistant at a chat as the home", async () => {
    expect(await appPage("strut/jamie", "session=abc")).toBe("/?input=session%3Dabc");
    expect(await appPage("strut/jamie")).toBe("/");
    expect(await appPage("strut/jamie", "")).toBe("/");
  });

  it("opens any other app at its own page, unpinned or not", async () => {
    fake.publish("stadeum/code/code", "Code");
    expect(await appPage("stadeum/code/code", "workspace=w1")).toBe("/apps/stadeum%2Fcode%2Fcode?input=workspace%3Dw1");
    await setAppPinned("stadeum/code/code", false);
    expect(await appPage("stadeum/code/code")).toBe("/apps/stadeum%2Fcode%2Fcode");
  });

  it("opens an admin's app for an admin alone, at its own page", async () => {
    expect(await appPage("strut/earnings")).toBeNull();
    who.email = "ada@acme.test";
    expect(await appPage("strut/earnings")).toBe("/earnings");
  });

  it("opens nothing strut does not list to the person, nor anything when strut does not answer", async () => {
    expect(await appPage("strut/views")).toBeNull();
    expect(await appPage("@peer/notes")).toBeNull();
    expect(await appPage("nope/missing", "x=1")).toBeNull();
    expect(await appPage(42 as unknown as string)).toBeNull();
    process.env.STRUT_URL = "http://127.0.0.1:9";
    expect(await appPage("strut/jamie")).toBeNull();
  });
});
