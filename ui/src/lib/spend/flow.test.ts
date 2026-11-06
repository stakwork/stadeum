import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ensureVirtualKey } from "@/lib/mothership/virtual-key";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { applyLimits, changeDefaults, changePersonLimit, NotAMember, readLimitSettings, recentChanges } from "./limits";
import { spendView } from "./report";

let fake: FakeStack;
let bo: { id: string; actor: string };

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
  await db.limitChange.deleteMany();
  const ada = await db.user.create({ data: { email: "ada@acme.test", name: "Ada", actor: "ada-1", role: "admin" } });
  bo = await db.user.create({ data: { email: "bo@acme.test", actor: "bo-2" } });
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

describe("limits", () => {
  const admin = { email: "ada@acme.test" };
  const budgets = () =>
    Object.fromEntries(
      fake.state.customers.map((c) => [
        c.name,
        c.budget && { max_limit: c.budget.max_limit, reset_duration: c.budget.reset_duration },
      ]),
    );

  it("writes a new default to everyone and records who changed it", async () => {
    expect(await changeDefaults(admin, { limitUsd: 200, reset: "1M" })).toEqual({ failed: 0 });
    expect(budgets()).toEqual({
      "ada-1": { max_limit: 200, reset_duration: "1M" },
      "bo-2": { max_limit: 200, reset_duration: "1M" },
    });
    expect((await recentChanges()).map((c) => [c.byEmail, c.subject, c.before, c.after])).toEqual([
      ["ada@acme.test", "everyone", "$1,000 every day", "$200 every month"],
    ]);
  });

  it("records nothing when nothing changed", async () => {
    expect(await changeDefaults(admin, { limitUsd: 200, reset: "1M" })).toEqual({ unchanged: true });
    expect(await recentChanges()).toHaveLength(1);
  });

  it("writes a person's own limit to them alone, and puts them back on everyone's", async () => {
    await changePersonLimit(admin, bo.id, 40);
    expect(budgets()["bo-2"]).toEqual({ max_limit: 40, reset_duration: "1M" });
    expect(budgets()["ada-1"]).toEqual({ max_limit: 200, reset_duration: "1M" });
    // The default's amount is stored as no own limit, so they follow the default from then on.
    await changePersonLimit(admin, bo.id, 200);
    expect((await db.user.findUnique({ where: { id: bo.id } }))!.spendLimitUsd).toBeNull();
    await changePersonLimit(admin, bo.id, 40);
    await changePersonLimit(admin, bo.id, null);
    expect(budgets()["bo-2"]).toEqual({ max_limit: 200, reset_duration: "1M" });
    expect((await recentChanges()).map((c) => [c.subject, c.before, c.after]).slice(0, 2)).toEqual([
      ["bo@acme.test", "$40.00", "everyone’s"],
      ["bo@acme.test", "everyone’s", "$40.00"],
    ]);
  });

  it("keeps a person's usage and last reset when their limit changes", async () => {
    const customer = fake.state.customers.find((c) => c.name === "bo-2")!;
    customer.budget!.last_reset = "2026-11-01T00:00:00Z";
    await changePersonLimit(admin, bo.id, 60);
    expect(customer.budget).toMatchObject({ max_limit: 60, last_reset: "2026-11-01T00:00:00Z" });
    await changePersonLimit(admin, bo.id, null);
  });

  it("saves and records a change the gateway missed, and the next pass puts it right", async () => {
    fake.state.down.bifrost = true;
    expect(await changeDefaults(admin, { limitUsd: 120, reset: "1w" })).toEqual({ failed: 2 });
    fake.state.down.bifrost = false;
    expect(await readLimitSettings()).toEqual({ limitUsd: 120, reset: "1w" });
    expect(budgets()["ada-1"]).toEqual({ max_limit: 200, reset_duration: "1M" });
    expect(await applyLimits()).toEqual({ updated: 2, failed: 0 });
    expect(budgets()["ada-1"]).toEqual({ max_limit: 120, reset_duration: "1w" });
  });

  it("never interleaves two saves", async () => {
    await Promise.all([
      changeDefaults(admin, { limitUsd: 300, reset: "1M" }),
      changePersonLimit(admin, bo.id, 75),
      applyLimits(),
    ]);
    expect(budgets()).toEqual({
      "ada-1": { max_limit: 300, reset_duration: "1M" },
      "bo-2": { max_limit: 75, reset_duration: "1M" },
    });
  });

  it("gives a new person the default at first sign-in", async () => {
    const cy = await db.user.create({ data: { email: "cy@acme.test", actor: "cy-3" } });
    await ensureVirtualKey(cy);
    expect(budgets()["cy-3"]).toEqual({ max_limit: 300, reset_duration: "1M" });
  });

  it("gives a new person their own limit at first sign-in, when it was set before", async () => {
    const dee = await db.user.create({ data: { email: "dee@acme.test", actor: "dee-4" } });
    expect(await changePersonLimit(admin, dee.id, 55)).toEqual({ failed: 0 });
    await ensureVirtualKey(dee);
    expect(budgets()["dee-4"]).toEqual({ max_limit: 55, reset_duration: "1M" });
  });

  it("counts everyone as missed when the gateway's credentials cannot be read, then puts it right", async () => {
    const pass = process.env.BIFROST_ADMIN_PASS;
    delete process.env.BIFROST_ADMIN_PASS;
    await db.org.update({ where: { id: "org" }, data: { bifrostAdminUser: null, bifrostAdminPassEnc: null } });
    fake.state.down.bifrost = true;
    const people = await db.mothershipUser.count({ where: { customerId: { not: null } } });
    expect(await changeDefaults(admin, { limitUsd: 90, reset: "1d" })).toEqual({ failed: people });
    expect(await readLimitSettings()).toEqual({ limitUsd: 90, reset: "1d" });
    process.env.BIFROST_ADMIN_PASS = pass;
    fake.state.down.bifrost = false;
    expect(await applyLimits()).toEqual({ updated: people, failed: 0 });
    expect(budgets()["ada-1"]).toEqual({ max_limit: 90, reset_duration: "1d" });
  });

  it("refuses a person who is no longer a member", async () => {
    await expect(changePersonLimit(admin, "gone", 10)).rejects.toThrow(NotAMember);
  });
});
