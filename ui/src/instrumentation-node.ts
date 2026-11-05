import { applyModels } from "@/lib/models/apply";
import { ensureGatewayLogRetention } from "@/lib/mothership/gateway-settings";
import { renewAllDelegations } from "@/lib/mothership/renew";

/**
 * Background upkeep, a minute after start and every six hours:
 * - every person's delegation, kept alive even when they don't visit
 *   (Hive's `strut-delegations` cron);
 * - the gateway's log retention;
 * - the org's models: each virtual key and strut's list and default
 *   (a wiped strut or a new person's key is put right here).
 * `STADEUM_RENEWAL=0` turns it off.
 */
const EVERY_MS = 6 * 60 * 60 * 1000;

const warn = (what: string) => (err: unknown) =>
  console.warn(`[upkeep] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);

if (process.env.STADEUM_RENEWAL !== "0") {
  const tick = async () => {
    await renewAllDelegations().catch(warn("delegation renewal"));
    await ensureGatewayLogRetention().catch(warn("gateway log retention"));
    await applyModels().catch(warn("models"));
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
