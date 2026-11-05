import { db } from "@/lib/db";
import { ensureDelegation } from "./delegation";

/**
 * Keep every person's delegation alive, including people who have not
 * visited lately (Hive's `strut-delegations` cron). `ensureDelegation`
 * re-mints past half-life, inside Hive's 15-day renew window.
 */
export async function renewAllDelegations(): Promise<Record<string, string>> {
  const users = await db.user.findMany({ select: { id: true, actor: true } });
  const out: Record<string, string> = {};
  for (const u of users) out[u.actor] = (await ensureDelegation(u)).status;
  return out;
}
