import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { GET } from "./route";

beforeEach(async () => {
  await db.apiKey.deleteMany();
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
});
afterAll(() => db.$disconnect());

const get = (headers: Record<string, string>) => GET(new Request("http://x/api/v1/members", { headers }));

describe("GET /api/v1/members", () => {
  it("is 401 without a valid key", async () => {
    expect((await get({})).status).toBe(401);
    expect((await get({ authorization: "Bearer stk_wrong" })).status).toBe(401);
  });

  it("lists the people with role and readiness, and nothing secret", async () => {
    const ada = await db.user.create({ data: { email: "ada@acme.test", name: "Ada", actor: "ada-1", role: "admin" } });
    const ben = await db.user.create({ data: { email: "ben@acme.test", actor: "ben-2" } });
    await db.mothershipUser.create({
      data: { userId: ada.id, delegationStatus: "pushed", userPrivkeyEnc: "SECRET-PRIV", vkValueEnc: "SECRET-VK" },
    });
    const made = await createApiKey(ada, { name: "ci", scope: "read" });
    if (!made.ok) throw new Error();

    const res = await get({ authorization: `Bearer ${made.key}` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET|privkey|hash|actor|stk_/i);
    const { members } = JSON.parse(text);
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ id: ada.id, name: "Ada", email: "ada@acme.test", role: "admin", can_run_apps: true });
    expect(members[1]).toMatchObject({ id: ben.id, name: null, role: "member", can_run_apps: false, last_seen_at: null });
    expect(typeof members[0].joined_at).toBe("string");
  });
});
