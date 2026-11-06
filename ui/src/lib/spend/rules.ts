/** Spending limits' rules, safe for the browser: periods, the typed amount, a person's budget. */

export const RESETS = ["1d", "1w", "1M"] as const;
export type Reset = (typeof RESETS)[number];

export const resetLabel: Record<Reset, string> = { "1d": "Every day", "1w": "Every week", "1M": "Every month" };
/** "this month", for "$12 of $200 this month". */
export const resetPeriod: Record<Reset, string> = { "1d": "today", "1w": "this week", "1M": "this month" };

export const isReset = (v: unknown): v is Reset => typeof v === "string" && (RESETS as readonly string[]).includes(v);

export interface LimitSettings {
  /** Everyone's limit unless they have their own, USD. */
  limitUsd: number;
  reset: Reset;
}

/** A person's budget: their own limit, else the org's, over the org's reset period. */
export function budgetFor(own: number | null | undefined, s: LimitSettings) {
  return { max_limit: own ?? s.limitUsd, reset_duration: s.reset };
}

/**
 * A limit as typed: a positive amount of dollars, at most two decimals, and
 * no more than `max`: the ceiling every person's delegation carries
 * (`delegationMaxCostUsd()`). The gateway checks that ceiling too, so a
 * limit above it would never take effect.
 */
export function parseLimit(raw: string, max: number): number | { error: string } {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return { error: "Enter an amount." };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: "Enter an amount in dollars, like 200." };
  const n = Number(cleaned);
  if (n <= 0) return { error: "A limit has to be more than $0." };
  if (n > max) {
    const most = `$${max.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return { error: `A limit can be at most ${most}, the most a person’s key can ever spend.` };
  }
  return n;
}
