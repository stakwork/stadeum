import { describe, expect, it } from "vitest";

import { compact, money } from "@/lib/format";
import { buckets, modelRows, personRows, tokenTotals } from "./report";
import { budgetFor, parseLimit } from "./rules";

const now = Date.parse("2026-11-06T15:30:00Z");

describe("buckets", () => {
  it("fills every UTC day in the window, quiet days at $0, with series summed", () => {
    const out = buckets(
      {
        bucket_size_seconds: 86400,
        dimension: "agent-name",
        series: [
          {
            dimension_value: "strut-agent",
            points: [
              { ts: "2026-11-06T00:00:00Z", cost: 2.5 },
              { ts: "2026-11-04T00:00:00Z", cost: 1 },
            ],
          },
          { dimension_value: "other", points: [{ ts: "2026-11-06T00:00:00Z", cost: 0.5 }] },
        ],
      },
      "7d",
      now,
    );
    expect(out).toHaveLength(7);
    expect(out.at(-1)).toEqual({ at: Date.parse("2026-11-06T00:00:00Z"), cost: 3 });
    expect(out.at(-3)).toEqual({ at: Date.parse("2026-11-04T00:00:00Z"), cost: 1 });
    expect(out[0]!.at).toBe(Date.parse("2026-10-31T00:00:00Z"));
    expect(out.filter((b) => b.cost === 0)).toHaveLength(5);
  });

  it("uses hours for the last 24 hours", () => {
    const out = buckets({ bucket_size_seconds: 3600, dimension: "agent-name", series: [] }, "24h", now);
    expect(out).toHaveLength(24);
    expect(out.at(-1)!.at).toBe(Date.parse("2026-11-06T15:00:00Z"));
    expect(out[1]!.at - out[0]!.at).toBe(3600_000);
  });

  it("is empty-safe", () => {
    expect(
      buckets({ bucket_size_seconds: 86400, dimension: "x", series: [] }, "30d", now).every((b) => b.cost === 0),
    ).toBe(true);
  });
});

describe("tokenTotals", () => {
  it("sums prompt and completion across series", () => {
    const t = tokenTotals({
      bucket_size_seconds: 86400,
      dimension: "agent-name",
      series: [
        {
          dimension_value: "a",
          points: [
            { ts: "x", prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
            { ts: "y", prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
          ],
        },
      ],
    });
    expect(t).toEqual({ input: 150, output: 15 });
  });
});

describe("personRows", () => {
  const people = [
    { id: "u1", name: "Ada", email: "ada@acme.test", actor: "ada-1", customerId: "c1" },
    { id: "u2", name: null, email: "bo@acme.test", actor: "bo-2", customerId: "c2" },
    { id: "u3", name: "Cy", email: "cy@acme.test", actor: "cy-3", customerId: null },
  ];
  const customers = [
    {
      id: "c1",
      name: "ada-1",
      created_at: "",
      budgets: [{ max_limit: 200, reset_duration: "1M", current_usage: 170 }],
    },
    { id: "c2", name: "bo-2", created_at: "", budgets: [{ max_limit: 50, reset_duration: "1M", current_usage: 10 }] },
  ];
  const spend = [
    { user_id: "bo-2", user_name: "bo-2", total_cost: 9, total_tokens: 900, request_count: 3 },
    { user_id: "ada-1", user_name: "ada-1", total_cost: 40, total_tokens: 4000, request_count: 9 },
    { user_id: "gone-9", user_name: "gone-9", total_cost: 1, total_tokens: 100, request_count: 1 },
  ];

  it("joins spend and budgets by actor and customer, most spent first", () => {
    const rows = personRows(people, spend, customers);
    expect(rows.map((r) => r.name)).toEqual(["Ada", "bo@acme.test", "gone-9", "Cy"]);
    expect(rows[0]).toMatchObject({
      spent: 40,
      limit: 200,
      used: 170,
      near: true,
      reached: false,
      period: "this month",
    });
    expect(rows[1]).toMatchObject({ spent: 9, limit: 50, used: 10, near: false, reached: false });
  });

  it("marks someone at or over their limit as reached, not near", () => {
    const over = [
      {
        id: "c1",
        name: "ada-1",
        created_at: "",
        budgets: [{ max_limit: 50, reset_duration: "1d", current_usage: 68.75 }],
      },
    ];
    const exact = [
      {
        id: "c1",
        name: "ada-1",
        created_at: "",
        budgets: [{ max_limit: 50, reset_duration: "1w", current_usage: 50 }],
      },
    ];
    expect(personRows(people, [], over)[0]).toMatchObject({ reached: true, near: false, period: "today" });
    expect(personRows(people, [], exact)[0]).toMatchObject({ reached: true, near: false, period: "this week" });
  });

  it("keeps someone the gateway billed but stadeum no longer lists, without a limit", () => {
    const gone = personRows(people, spend, customers).find((r) => r.name === "gone-9")!;
    expect(gone).toMatchObject({ userId: "", limit: null, used: null, near: false });
  });

  it("shows no limit for someone without a customer yet", () => {
    const cy = personRows(people, spend, customers).find((r) => r.name === "Cy")!;
    expect(cy).toMatchObject({ spent: 0, limit: null, used: null });
  });
});

describe("modelRows", () => {
  it("prefixes the provider, keeps free models, and gives shares", () => {
    const rows = modelRows([
      { model: "gemma", provider: "maple", total_cost: 0, total_tokens: 500, request_count: 2 },
      { model: "claude-sonnet-5-5", provider: "anthropic", total_cost: 3, total_tokens: 1000, request_count: 4 },
      { model: "gpt-6", provider: "openai", total_cost: 1, total_tokens: 100, request_count: 1 },
      { model: "z-ai/glm-5.3", provider: "numes", total_cost: 0, total_tokens: 50, request_count: 1 },
      { model: "maple/gpt-oss-120b", provider: "maple", total_cost: 0, total_tokens: 10, request_count: 1 },
    ]);
    // A model id with a slash of its own still gets its provider; one already prefixed is left alone.
    expect(rows.map((r) => r.name)).toEqual([
      "anthropic/claude-sonnet-5-5",
      "openai/gpt-6",
      "maple/gemma",
      "numes/z-ai/glm-5.3",
      "maple/gpt-oss-120b",
    ]);
    expect(rows[0]!.share).toBe(0.75);
    expect(rows[2]).toMatchObject({ spent: 0, share: 0 });
  });
});

describe("formats", () => {
  it("shortens token counts without 1000k or 10.0M", () => {
    expect([940, 12_400, 999_400, 999_600, 3_420_000, 9_990_000, 12_600_000].map(compact)).toEqual([
      "940",
      "12k",
      "999k",
      "1.0M",
      "3.4M",
      "10M",
      "13M",
    ]);
  });

  it("shows cents under $100 unless the column is whole dollars", () => {
    expect([0, 0.82, 64.47, 1284].map((n) => money(n))).toEqual(["$0", "$0.82", "$64.47", "$1,284"]);
    expect(money(90.9, { whole: true })).toBe("$91");
  });
});

describe("limit rules", () => {
  it("parses dollars and refuses anything else", () => {
    expect(parseLimit("200", 10_000)).toBe(200);
    expect(parseLimit("$1,500.50", 10_000)).toBe(1500.5);
    expect(parseLimit("10000", 10_000)).toBe(10_000);
    for (const bad of ["", "0", "-5", "ten", "1.234", "1e3", "10000.01", "2000000"]) {
      expect(parseLimit(bad, 10_000)).toEqual({ error: expect.any(String) });
    }
    expect(parseLimit("20000", 10_000)).toEqual({
      error: "A limit can be at most $10,000, the most a person’s key can ever spend.",
    });
  });

  it("uses a person's own limit, else everyone's, over the org's period", () => {
    const s = { limitUsd: 200, reset: "1w" as const };
    expect(budgetFor(null, s)).toEqual({ max_limit: 200, reset_duration: "1w" });
    expect(budgetFor(75, s)).toEqual({ max_limit: 75, reset_duration: "1w" });
  });
});
