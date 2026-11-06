import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ensureVirtualKey } from "@/lib/mothership/virtual-key";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { spendView } from "./report";

let fake: FakeStack;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeAll(async () => {
  fake = await startFakeStack({ providers: ["anthropic"] });
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    BIFROST_URL: fake.bifrostUrl,
    BIFROST_ADMIN_PASS: fake.adminPass,
    STRUT_URL: fake.strutUrl,
  });
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await db.org.deleteMany();
  const ada = await db.user.create({ data: { email: "ada@acme.test", name: "Ada", actor: "ada-1", role: "admin" } });
  const bo = await db.user.create({ data: { email: "bo@acme.test", actor: "bo-2" } });
  await ensureVirtualKey(ada);
  await ensureVirtualKey(bo);
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});

describe("spendView", () => {
  it("sums the gateway's calls per person, per model and per day, with each person's budget", async () => {
    fake.state.calls.push(
      {
        ts: hoursAgo(1),
        user_id: "ada-1",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        cost: 120,
        prompt_tokens: 9000,
        completion_tokens: 1000,
      },
      {
        ts: hoursAgo(30),
        user_id: "bo-2",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        cost: 2.5,
        prompt_tokens: 400,
        completion_tokens: 100,
      },
      {
        ts: hoursAgo(50),
        user_id: "bo-2",
        provider: "maple",
        model: "gemma4-31b",
        cost: 0,
        prompt_tokens: 300,
        completion_tokens: 50,
      },
      {
        ts: hoursAgo(24 * 40),
        user_id: "ada-1",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        cost: 99,
        prompt_tokens: 1,
        completion_tokens: 1,
      },
    );
    const view = await spendView("7d");

    expect(view.total).toBeCloseTo(122.5);
    expect(view.tokens).toEqual({ input: 9700, output: 1150 });
    expect(view.buckets).toHaveLength(7);

    // Each person's limit is the budget stadeum gave them at sign-in ($1,000 a day), read back from the gateway.
    expect(view.people.map((p) => [p.name, p.spent, p.limit, p.period])).toEqual([
      ["Ada", 120, 1000, "today"],
      ["bo@acme.test", 2.5, 1000, "today"],
    ]);
    // A budget counts since its last reset, not over the report's window.
    expect(view.people[0]!.used).toBe(219);

    expect(view.models.map((m) => [m.name, m.spent])).toEqual([
      ["anthropic/claude-sonnet-5-5", 122.5],
      ["maple/gemma4-31b", 0],
    ]);
  });

  it("reads every customer, a page at a time", async () => {
    // Ada's customer lands on the second page.
    for (let i = 0; i < 600; i++) {
      fake.state.customers.unshift({
        id: `extra-${i}`,
        name: `extra-${i}`,
        created_at: "",
        budget: { max_limit: 1, reset_duration: "1d" },
      });
    }
    const view = await spendView("24h");
    expect(view.people.find((p) => p.name === "Ada")!.limit).toBe(1000);
    fake.state.customers.splice(0, 600);
  });

  it("throws when the gateway does not answer, so the page can say so", async () => {
    fake.state.down.bifrost = true;
    await expect(spendView("30d")).rejects.toThrow();
    fake.state.down.bifrost = false;
  });
});
