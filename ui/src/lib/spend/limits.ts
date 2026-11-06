import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { governanceClient } from "@/lib/mothership/admin-credentials";
import { DEFAULT_BUDGET_RESET_DURATION, DEFAULT_CUSTOMER_BUDGET_USD } from "@/lib/mothership/constants";
import { withLock } from "@/lib/mothership/lock";
import { budgetFor, isReset, resetLabel, type LimitSettings } from "./rules";

/**
 * Spending limits. Each person's limit is their Bifrost customer's budget
 * (`max_limit` over `reset_duration`): the gateway counts it and refuses a
 * call past it. Stadeum keeps what the admins asked for (the default, how
 * often it resets, and anyone's own limit) and writes it to every customer:
 * on a save, and again on every upkeep pass, so a write the gateway missed
 * is put right. Every change is recorded in `LimitChange`.
 *
 * Every write takes the one "spend" lock, so two saves (or a save and the
 * upkeep pass) never interleave.
 */

const LOCK = "spend";

export async function readLimitSettings(): Promise<LimitSettings> {
  const org = await db.org.findUnique({ where: { id: "org" }, select: { spendLimitUsd: true, spendReset: true } });
  const fallback = isReset(DEFAULT_BUDGET_RESET_DURATION) ? DEFAULT_BUDGET_RESET_DURATION : "1d";
  return {
    limitUsd: org?.spendLimitUsd ?? DEFAULT_CUSTOMER_BUDGET_USD,
    reset: isReset(org?.spendReset) ? org.spendReset : fallback,
  };
}

const describeDefault = (s: LimitSettings) =>
  `${money(s.limitUsd, { whole: s.limitUsd >= 100 })} ${resetLabel[s.reset].toLowerCase()}`;
const describeOwn = (own: number | null) => (own === null ? "everyone’s" : money(own, { whole: own >= 100 }));

/** Every person's budget to the gateway. Call under the lock. */
async function writeAll(): Promise<{ updated: number; failed: number }> {
  const [settings, client, people] = await Promise.all([
    readLimitSettings(),
    governanceClient(),
    db.mothershipUser.findMany({
      where: { customerId: { not: null } },
      select: { customerId: true, user: { select: { spendLimitUsd: true } } },
    }),
  ]);
  let updated = 0;
  let failed = 0;
  for (const p of people) {
    try {
      await client.updateCustomerBudget(p.customerId!, budgetFor(p.user.spendLimitUsd, settings));
      updated++;
    } catch (err) {
      failed++;
      console.warn(`[spend] budget for ${p.customerId} not set: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { updated, failed };
}

/** One person's budget to the gateway. Call under the lock. */
async function writeOne(userId: string): Promise<void> {
  const [settings, client, m] = await Promise.all([
    readLimitSettings(),
    governanceClient(),
    db.mothershipUser.findUnique({
      where: { userId },
      select: { customerId: true, user: { select: { spendLimitUsd: true } } },
    }),
  ]);
  if (!m?.customerId) return;
  await client.updateCustomerBudget(m.customerId, budgetFor(m.user.spendLimitUsd, settings));
}

/**
 * Write every person's budget to the gateway again: after a save, and on
 * every upkeep pass. A person without a customer yet gets theirs at first
 * sign-in (`ensureCustomer`), from the same settings.
 */
export function applyLimits(): Promise<{ updated: number; failed: number }> {
  return withLock(LOCK, writeAll);
}

export type Change = { unchanged: true } | { unchanged?: false; failed: number };

/** The default limit and how often limits reset: saved, recorded, then written to everyone. */
export function changeDefaults(by: { email: string }, next: LimitSettings): Promise<Change> {
  return withLock(LOCK, async () => {
    const before = await readLimitSettings();
    if (before.limitUsd === next.limitUsd && before.reset === next.reset) return { unchanged: true };
    const data = { spendLimitUsd: next.limitUsd, spendReset: next.reset };
    await db.$transaction([
      db.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data }),
      db.limitChange.create({
        data: { byEmail: by.email, subject: "everyone", before: describeDefault(before), after: describeDefault(next) },
      }),
    ]);
    const { failed } = await writeAll();
    return { failed };
  });
}

/**
 * One person's own limit, or `null` to put them back on everyone's. A limit
 * equal to the default is stored as `null`, so they follow later changes to it.
 */
export function changePersonLimit(by: { email: string }, userId: string, own: number | null): Promise<Change> {
  return withLock(LOCK, async () => {
    const [settings, person] = await Promise.all([
      readLimitSettings(),
      db.user.findUnique({ where: { id: userId }, select: { email: true, spendLimitUsd: true } }),
    ]);
    if (!person) throw new Error("No such person.");
    const next = own === settings.limitUsd ? null : own;
    if (next === person.spendLimitUsd) return { unchanged: true };
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { spendLimitUsd: next } }),
      db.limitChange.create({
        data: {
          byEmail: by.email,
          subject: person.email,
          before: describeOwn(person.spendLimitUsd),
          after: describeOwn(next),
        },
      }),
    ]);
    try {
      await writeOne(userId);
      return { failed: 0 };
    } catch (err) {
      console.warn(`[spend] budget for ${userId} not set: ${err instanceof Error ? err.message : String(err)}`);
      return { failed: 1 };
    }
  });
}

/** The latest changes, newest first. */
export function recentChanges(take = 10) {
  return db.limitChange.findMany({ orderBy: { createdAt: "desc" }, take });
}
