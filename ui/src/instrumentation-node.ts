import { renewAllDelegations } from "@/lib/mothership/renew";

/**
 * Background renewal: keep every person's delegation alive even when they
 * don't visit (Hive's `strut-delegations` cron). `STADEUM_RENEWAL=0` turns it off.
 */
const EVERY_MS = 6 * 60 * 60 * 1000;

if (process.env.STADEUM_RENEWAL !== "0") {
  const tick = () =>
    renewAllDelegations().catch((err) =>
      console.warn(`[mothership] renewal pass failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
