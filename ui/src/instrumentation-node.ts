import { applyModels } from "@/lib/models/apply";
import { applyGivenProviders, recheckGivenFederation } from "@/lib/models/providers";
import { ensureGatewayLogRetention } from "@/lib/mothership/gateway-settings";
import { sweepGrantKeys } from "@/lib/mothership/grant-key";
import { renewAllDelegations } from "@/lib/mothership/renew";
import { applyGivenBackup } from "@/lib/ops/store";
import { applyLimits } from "@/lib/spend/limits";

/**
 * Background upkeep, a minute after start and every six hours:
 * - every person's delegation, kept alive even when they don't visit
 *   (Hive's `strut-delegations` cron);
 * - the gateway's log retention;
 * - the providers the box's host gives (STADEUM_MODEL_PROVIDERS), so a
 *   gateway that lost them gets them back before the models are applied.
 *   A given federation Anthropic refuses at the first of these is checked
 *   again each minute, for a quarter of an hour: a new box's first check
 *   comes before Anthropic has read its gateway's key set;
 * - the org's models: each virtual key and strut's list and default
 *   (a wiped strut or a new person's key is put right here);
 * - spending limits: every person's budget, so a limit the gateway missed
 *   on a save is put right;
 * - the backup destination the box's host gives (STADEUM_BACKUP_DESTINATION),
 *   so an edit to it is put right;
 * - grants' model keys past their expiry, which the gateway already
 *   refuses, deleted in case strut never released them.
 * `STADEUM_RENEWAL=0` turns it off.
 */
const EVERY_MS = 6 * 60 * 60 * 1000;
const RECHECK_MS = 60_000;
const RECHECKS = 15;

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
    await sweepGrantKeys().catch(warn("expired grant keys"));
  };
  const recheck = (left: number) => {
    setTimeout(async () => {
      const settled = await recheckGivenFederation().catch((err) => (warn("given federation")(err), false));
      if (!settled && left > 1) recheck(left - 1);
    }, RECHECK_MS).unref?.();
  };
  setTimeout(() => tick().then(() => recheck(RECHECKS)), 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
