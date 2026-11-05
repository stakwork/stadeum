import { db } from "@/lib/db";
import { governanceClient, pluginClient } from "@/lib/mothership/admin-credentials";
import type { BifrostClient } from "@/lib/mothership/bifrost-client";
import { withLock } from "@/lib/mothership/lock";
import { desiredGrants, syncGrants } from "@/lib/mothership/virtual-key";
import { getModelCatalog, putDeploymentSetting, type StrutModelCatalog } from "@/lib/strut/client";
import { planModels, priceTable, splitName, type ModelPlan, type ModelSettings } from "./plan";
import { keyedProviders, providerStates, type ProviderState } from "./providers";
import { readModelSettings, saveModelSettings } from "./settings";

/**
 * The org's models, carried out (docs/models.md):
 * - each person's virtual key allows the list (the gateway enforces it);
 * - strut gets the list and the default as `STRUT_MODELS` and
 *   `STRUT_DEFAULT_MODEL` (what Jamie's picker shows, and what a turn runs
 *   on when nobody picks);
 * - the gateway gets a price for each model its datasheet lacks (Maple's,
 *   Numes', an Other provider's), so its calls count against the caps.
 */

export interface ApplyResult {
  /** Virtual keys changed to match the list. */
  updated: number;
  /** Virtual keys that could not be read or written. */
  failed: number;
  /** Strut took the list and the default. */
  strut: boolean;
  /** The gateway took the price table. False on a gateway older than v0.4.398 (no `/_plugin/pricing`). */
  prices: boolean;
}

/** Strut's names for its settings (strut src/steps/core/agent.ts, src/llm.ts). */
export const STRUT_DEFAULT_MODEL = "STRUT_DEFAULT_MODEL";
export const STRUT_MODELS = "STRUT_MODELS";

export function applyModels(): Promise<ApplyResult> {
  return withLock("models", async () => {
    const client = await governanceClient();
    const grants = await desiredGrants(client);
    let updated = 0;
    let failed = 0;
    const people = await db.mothershipUser.findMany({ where: { vkId: { not: null } }, select: { vkId: true } });
    for (const { vkId } of people) {
      try {
        const { virtual_key } = await client.getVirtualKey(vkId!);
        if (await syncGrants(client, virtual_key, grants)) updated++;
      } catch (err) {
        failed++;
        console.warn(`[models] virtual key ${vkId} not synced: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const strut = await pushToStrut(client);
    return { updated, failed, strut, prices: await pushPrices() };
  });
}

/** The whole price table to the gateway. False when strut or the gateway does not answer, or the gateway has no such route. */
async function pushPrices(): Promise<boolean> {
  try {
    const [catalog, settings] = await Promise.all([getModelCatalog(), readModelSettings()]);
    await pluginClient().putPricing(priceTable(catalog, settings.prices));
    return true;
  } catch (err) {
    console.warn(`[models] gateway prices not updated: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** `STRUT_DEFAULT_MODEL` and `STRUT_MODELS` to strut. False when strut or the gateway does not answer. */
async function pushToStrut(client: BifrostClient): Promise<boolean> {
  try {
    const [catalog, states, settings] = await Promise.all([getModelCatalog(), providerStates(client), readModelSettings()]);
    const plan = planModels(settings, catalog, keyedProviders(states));
    if (plan.default) await putDeploymentSetting(STRUT_DEFAULT_MODEL, plan.default);
    await putDeploymentSetting(STRUT_MODELS, JSON.stringify(plan.allowed));
    return true;
  } catch (err) {
    console.warn(`[models] strut not updated: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * A provider just got a key. Once the admin has saved a list, the provider's
 * catalog models join it, so a pasted key is enough to use them; until then
 * every catalog model is allowed anyway.
 */
export async function allowProviderModels(strutProvider: string): Promise<void> {
  const settings = await readModelSettings();
  if (settings.models === null) return;
  const catalog = await getModelCatalog().catch(() => null);
  if (!catalog) return;
  const added = catalog.models.filter((m) => m.provider === strutProvider).map((m) => m.name);
  const models = [...new Set([...settings.models, ...added])];
  if (models.length !== settings.models.length) await saveModelSettings({ ...settings, models });
}

// ── the page ────────────────────────────────────────────────────────────

export interface ModelRow {
  name: string;
  modelId: string;
  /** aieo's short name (`sonnet`), when the model has one. */
  alias?: string;
  /** USD per million tokens, when stadeum sets the model's price: strut's own rate (Maple, Numes) or the admin's. */
  price?: { input: number; output: number };
  allowed: boolean;
  isDefault: boolean;
}

export interface ModelsView {
  providers: ProviderState[];
  /** Each provider with a key, and its models: strut's catalog plus any the admin typed in. Null when strut does not answer. */
  groups: Array<{ provider: ProviderState; models: ModelRow[] }> | null;
  plan: ModelPlan | null;
}

/** What the Models page draws. Throws when the gateway does not answer. */
export async function modelsView(): Promise<ModelsView> {
  const providers = await providerStates();
  const [catalog, settings] = await Promise.all([getModelCatalog().catch(() => null as StrutModelCatalog | null), readModelSettings()]);
  if (!catalog) return { providers, groups: null, plan: null };
  const plan = planModels(settings, catalog, keyedProviders(providers));
  const groups = providers
    .filter((p) => p.preview)
    .map((p) => {
      const known = catalog.models.filter((m) => m.provider === p.strut);
      const typed = (settings.models ?? [])
        .filter((n) => splitName(n)?.provider === p.strut && !known.some((m) => m.name === n))
        .map((n) => ({ name: n, alias: undefined, modelId: splitName(n)!.modelId, pricing: undefined }));
      const models = [...known, ...typed].map((m) => {
        const typedPrice = settings.prices[m.name];
        const price = typedPrice ?? (m.pricing ? { input: m.pricing.inputTokenPrice, output: m.pricing.outputTokenPrice } : undefined);
        return {
          name: m.name,
          modelId: m.modelId,
          ...(m.alias ? { alias: m.alias } : {}),
          ...(price ? { price } : {}),
          allowed: plan.allowed.includes(m.name),
          isDefault: plan.default === m.name,
        };
      });
      return { provider: p, models };
    });
  return { providers, groups, plan };
}

export { saveModelSettings, readModelSettings, type ModelSettings };
