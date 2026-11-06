import { db } from "@/lib/db";
import { governanceClient, pluginClient } from "@/lib/mothership/admin-credentials";
import type {
  BifrostCustomer,
  CostPoint,
  HistogramResponse,
  ModelSpendRow,
  SpendWindow,
  TokenPoint,
  UserSpendRow,
} from "@/lib/mothership/types";

/**
 * The Spending page's numbers, all read from the gateway: its rollups
 * over a rolling window, and each person's budget (their limit and what it
 * has counted since its last reset). Nothing here writes.
 */

export const WINDOWS: SpendWindow[] = ["24h", "7d", "30d", "90d"];
export const windowLabel: Record<SpendWindow, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};
export const isWindow = (v: unknown): v is SpendWindow => typeof v === "string" && (WINDOWS as string[]).includes(v);

/** Hours for the last day, UTC days for the rest. */
export const bucketFor = (w: SpendWindow) => (w === "24h" ? "1h" : "1d");
const windowMs: Record<SpendWindow, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5 };

/** At or over this share of their limit, a person shows as near it. */
export const NEAR = 0.8;

/** A budget's reset period in words, for "$12 of $200 this month". */
const PERIOD: Record<string, string> = { "1d": "today", "1w": "this week", "1M": "this month", "1Y": "this year" };
export const periodOf = (resetDuration: string | undefined) =>
  resetDuration ? (PERIOD[resetDuration] ?? `per ${resetDuration}`) : "";

export interface Bucket {
  /** Bucket start, epoch ms. */
  at: number;
  cost: number;
}

/**
 * Every bucket in the window, oldest first, with the cost of every series
 * summed in. Buckets the gateway left out (no calls) are $0, so the chart
 * shows quiet days rather than skipping them.
 */
export function buckets(hist: HistogramResponse<CostPoint>, window: SpendWindow, now: number): Bucket[] {
  const size = (hist.bucket_size_seconds || (bucketFor(window) === "1h" ? 3600 : 86400)) * 1000;
  const sums = new Map<number, number>();
  for (const s of hist.series ?? []) {
    for (const p of s.points ?? []) {
      const t = Date.parse(p.ts);
      if (Number.isNaN(t)) continue;
      const start = Math.floor(t / size) * size;
      sums.set(start, (sums.get(start) ?? 0) + (p.cost || 0));
    }
  }
  const last = Math.floor(now / size) * size;
  const first = Math.floor((now - windowMs[window]) / size) * size + size;
  const out: Bucket[] = [];
  for (let at = first; at <= last; at += size) out.push({ at, cost: sums.get(at) ?? 0 });
  return out;
}

export function tokenTotals(hist: HistogramResponse<TokenPoint>): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const s of hist.series ?? []) {
    for (const p of s.points ?? []) {
      input += p.prompt_tokens || 0;
      output += p.completion_tokens || 0;
    }
  }
  return { input, output };
}

export interface PersonRow {
  userId: string;
  name: string;
  email: string;
  spent: number;
  tokens: number;
  /** Their budget: the limit, what it has counted since its last reset, and over what period. */
  limit: number | null;
  used: number | null;
  period: string;
  /** At or over 80% of their limit, but under it. */
  near: boolean;
  /** At or over their limit: the gateway refuses their calls until it resets. */
  reached: boolean;
}

interface Person {
  id: string;
  name: string | null;
  email: string;
  actor: string;
  customerId: string | null;
}

/**
 * Everyone with a gateway customer, plus anyone the gateway billed whom
 * stadeum no longer lists, by spend in the window, then name.
 */
export function personRows(people: Person[], spend: UserSpendRow[], customers: BifrostCustomer[]): PersonRow[] {
  const byActor = new Map(spend.map((r) => [r.user_id, r]));
  const byCustomer = new Map(customers.map((c) => [c.id, c]));
  const rows: PersonRow[] = people.map((p) => {
    const s = byActor.get(p.actor);
    byActor.delete(p.actor);
    const budget = p.customerId
      ? (byCustomer.get(p.customerId)?.budgets?.[0] ?? byCustomer.get(p.customerId)?.budget)
      : undefined;
    const limit = budget?.max_limit ?? null;
    const used = budget ? (budget.current_usage ?? 0) : null;
    const share = limit !== null && used !== null && limit > 0 ? used / limit : 0;
    return {
      userId: p.id,
      name: p.name || p.email,
      email: p.email,
      spent: s?.total_cost ?? 0,
      tokens: s?.total_tokens ?? 0,
      limit,
      used,
      period: periodOf(budget?.reset_duration),
      near: share >= NEAR && share < 1,
      reached: share >= 1,
    };
  });
  for (const s of byActor.values()) {
    rows.push({
      userId: "",
      name: s.user_name || s.user_id,
      email: "",
      spent: s.total_cost,
      tokens: s.total_tokens,
      limit: null,
      used: null,
      period: "",
      near: false,
      reached: false,
    });
  }
  return rows.sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
}

export interface ModelRow {
  name: string;
  spent: number;
  tokens: number;
  share: number;
}

/** The same model from two providers stays two rows; the provider prefixes the name. */
export function modelRows(spend: ModelSpendRow[]): ModelRow[] {
  const total = spend.reduce((a, r) => a + (r.total_cost || 0), 0);
  return spend
    .map((r) => ({
      name: !r.provider || r.model.startsWith(`${r.provider}/`) ? r.model : `${r.provider}/${r.model}`,
      spent: r.total_cost || 0,
      tokens: r.total_tokens || 0,
      share: total > 0 ? (r.total_cost || 0) / total : 0,
    }))
    .sort((a, b) => b.spent - a.spent || b.tokens - a.tokens);
}

export interface SpendView {
  window: SpendWindow;
  buckets: Bucket[];
  total: number;
  tokens: { input: number; output: number };
  people: PersonRow[];
  models: ModelRow[];
}

/** Every customer the gateway holds, a page at a time. */
async function allCustomers(): Promise<BifrostCustomer[]> {
  const client = await governanceClient();
  const out: BifrostCustomer[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await client.listCustomers({ limit: 500, offset });
    out.push(...(page.customers ?? []));
    if ((page.customers ?? []).length < 500 || offset >= 50_000) return out;
  }
}

/** Everything the page shows. Throws when the gateway does not answer. */
export async function spendView(window: SpendWindow, now = Date.now()): Promise<SpendView> {
  const plugin = pluginClient();
  const [byUser, byModel, cost, tokens, customers, people] = await Promise.all([
    plugin.spendByUser(window),
    plugin.spendByModel(window),
    plugin.costHistogram(window, bucketFor(window)),
    plugin.tokenHistogram(window, bucketFor(window)),
    allCustomers(),
    db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        actor: true,
        mothership: { select: { customerId: true } },
      },
    }),
  ]);
  const days = buckets(cost, window, now);
  return {
    window,
    buckets: days,
    total: days.reduce((a, b) => a + b.cost, 0),
    tokens: tokenTotals(tokens),
    people: personRows(
      people.map((p) => ({ ...p, customerId: p.mothership?.customerId ?? null })),
      byUser.results ?? [],
      customers,
    ),
    models: modelRows(byModel.results ?? []),
  };
}
