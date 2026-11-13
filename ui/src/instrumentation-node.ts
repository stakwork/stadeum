import { applyModels } from "@/lib/models/apply";
import { applyGivenProviders } from "@/lib/models/providers";
import { ensureGatewayLogRetention } from "@/lib/mothership/gateway-settings";
import { renewAllDelegations } from "@/lib/mothership/renew";
import { applyGivenBackup } from "@/lib/ops/store";
import { applyLimits } from "@/lib/spend/limits";

/**
 * Background upkeep, a minute after start and every six hours:
 * - every person's delegation, kept alive even when they don't visit
 *   (Hive's `strut-delegations` cron);
 * - the gateway's log retention;
 * - the providers the box's host gives (STADEUM_MODEL_PROVIDERS), so a
 *   gateway that lost them gets them back before the models are applied;
 * - the org's models: each virtual key and strut's list and default
 *   (a wiped strut or a new person's key is put right here);
 * - spending limits: every person's budget, so a limit the gateway missed
 *   on a save is put right;
 * - the backup destination the box's host gives (STADEUM_BACKUP_DESTINATION),
 *   so an edit to it is put right.
 * `STADEUM_RENEWAL=0` turns it off.
 */
const EVERY_MS = 6 * 60 * 60 * 1000;

const warn = (what: string) => (err: unknown) =>
  console.warn(`[upkeep] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);

if (process.env.STADEUM_RENEWAL !== "0") {
  const tick = async () => {
    await renewAllDelegations().catch(warn("delegation renewal"));
    await ensureGatewayLogRetention().catch(warn("gateway log retention"));
    await applyGivenProviders().catch(warn("given providers"));
    await applyModels().catch(warn("models"));
    await applyLimits().catch(warn("spending limits"));
    await applyGivenBackup().catch(warn("given backup destination"));
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
