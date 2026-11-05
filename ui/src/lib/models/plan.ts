import { PROVIDERS } from "@/lib/mothership/constants";
import type { GatewayPriceRow } from "@/lib/mothership/types";
import type { StrutModelCatalog } from "@/lib/strut/client";

/**
 * Which models people may use, as pure functions over what the admin saved,
 * strut's catalog and the providers that have a key (docs/models.md, "The
 * levels"). Names are strut's canonical `provider/id`; the gateway names the
 * same provider its own way (`google` is bifrost's `gemini`).
 */

/** USD per million tokens, as the admin typed it for a model strut has no rate for. */
export interface TypedPrice {
  input: number;
  output: number;
}

export interface ModelSettings {
  /** The admin's list. Null until they save one. */
  models: string[] | null;
  defaultModel: string | null;
  /** Prices the admin typed, by model name: an Other provider's models. */
  prices: Record<string, TypedPrice>;
}

export interface ModelPlan {
  /** What people may pick: the admin's list, or the whole catalog until they save one, on providers with a key. */
  allowed: string[];
  /** What a turn runs on when nobody picks: strut's `STRUT_DEFAULT_MODEL`. "" when nothing is known. */
  default: string;
  /** The admin has saved a list. */
  explicit: boolean;
}

/** One provider entry of a person's virtual key. */
export interface Grant {
  provider: string;
  allowed_models: string[];
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** bifrost's name for strut's provider. */
export const bifrostProviderOf = (strutProvider: string): string =>
  PROVIDERS.find((p) => p.strut === strutProvider)?.id ?? strutProvider;

/** `openrouter/moonshotai/kimi-k3` → `openrouter` + `moonshotai/kimi-k3`: the first segment is the provider. */
export function splitName(name: string): { provider: string; modelId: string } | null {
  const i = name.indexOf("/");
  if (i <= 0 || i === name.length - 1) return null;
  return { provider: name.slice(0, i), modelId: name.slice(i + 1) };
}

export function planModels(settings: ModelSettings, catalog: StrutModelCatalog, keyed: ReadonlySet<string>): ModelPlan {
  const explicit = settings.models !== null;
  const base = settings.models ?? catalog.models.map((m) => m.name);
  const allowed = unique(base.filter((n) => keyed.has(splitName(n)?.provider ?? "")));
  const chosen = [settings.defaultModel, catalog.default].find((n): n is string => !!n && allowed.includes(n));
  const providerDefault = catalog.models.find((m) => m.default && allowed.includes(m.name))?.name;
  return {
    allowed,
    default: chosen ?? providerDefault ?? allowed[0] ?? settings.defaultModel ?? catalog.default,
    explicit,
  };
}

/**
 * What every person's virtual key may call. Until the admin saves a list,
 * every model of every provider the gateway has (`["*"]`), as before. Then
 * exactly that list, per provider; a provider with none of its models on it
 * is left off the key. An empty list allows nothing (bifrost's WhiteList).
 */
export function grantsFor(models: string[] | null, gatewayProviders: string[]): Grant[] {
  if (models === null) return gatewayProviders.map((provider) => ({ provider, allowed_models: ["*"] }));
  const byProvider = new Map<string, string[]>();
  for (const name of models) {
    const s = splitName(name);
    if (!s) continue;
    const provider = bifrostProviderOf(s.provider);
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), s.modelId]);
  }
  return gatewayProviders
    .filter((p) => byProvider.has(p))
    .map((provider) => ({ provider, allowed_models: unique(byProvider.get(provider)!) }));
}

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:~\-/]*$/;

/** A canonical name an admin may put on the list: one of `providers` (strut's names) and a plausible id. */
export function isModelName(name: string, providers: ReadonlySet<string>): boolean {
  const s = splitName(name);
  return !!s && name.length <= 200 && providers.has(s.provider) && MODEL_ID_RE.test(s.modelId.replace(/^~/, ""));
}

/** A typed price: blank is none; otherwise a number of dollars per million tokens, zero allowed. */
function parsePrice(raw: string): number | null | "bad" {
  const t = raw.trim().replace(/^\$/, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100_000 ? n : "bad";
}

/**
 * The Models form, checked: the ticked models plus one typed in (with its
 * price, when given), and the default among them. Prices are kept for the
 * models still allowed. Errors are what the admin reads.
 */
export function parseModelsForm(
  input: { ticked: string[]; other: string; default: string; otherInput?: string; otherOutput?: string },
  providers: ReadonlySet<string>,
  prices: Record<string, TypedPrice> = {},
): ModelSettings | { error: string } {
  const other = input.other.trim();
  if (other && !isModelName(other, providers)) {
    return { error: `“${other}” is not a model name stadeum knows. Write it as provider/id, e.g. openrouter/deepseek/deepseek-v4.` };
  }
  const models = unique([...input.ticked.map((t) => t.trim()).filter(Boolean), ...(other ? [other] : [])]);
  const bad = models.find((m) => !isModelName(m, providers));
  if (bad) return { error: `“${bad}” is not a model name stadeum knows.` };
  if (models.length === 0) return { error: "Allow at least one model." };
  const defaultModel = input.default.trim();
  if (!models.includes(defaultModel)) return { error: "Choose the default from the allowed models." };
  const kept = Object.fromEntries(Object.entries(prices).filter(([n]) => models.includes(n)));
  const [pin, pout] = [parsePrice(input.otherInput ?? ""), parsePrice(input.otherOutput ?? "")];
  if (pin === "bad" || pout === "bad") return { error: "A price is dollars per million tokens: a number, 0 for free." };
  if (other && (pin !== null || pout !== null)) {
    if (pin === null || pout === null) return { error: "Give both prices, input and output, or neither." };
    kept[other] = { input: pin, output: pout };
  }
  return { models, defaultModel, prices: kept };
}

/**
 * The gateway's runtime price table (`PUT /_plugin/pricing`, which replaces
 * it whole), keyed as the gateway sees a call: `<provider>/<model>`, which
 * is strut's canonical name (`maple/gemma4-31b`, `numes/z-ai/glm-5.3`).
 * Strut's catalog prices only models with a rate of their own (Maple's and
 * Numes' tables); bifrost's datasheet prices the rest. A typed price wins.
 */
export function priceTable(catalog: StrutModelCatalog, prices: Record<string, TypedPrice>): Record<string, GatewayPriceRow> {
  const table: Record<string, GatewayPriceRow> = {};
  for (const m of catalog.models) {
    const p = m.pricing;
    if (!p) continue;
    table[m.name] = {
      input_per_mtok: p.inputTokenPrice,
      output_per_mtok: p.outputTokenPrice,
      ...(p.cacheReadPrice != null ? { cache_read_per_mtok: p.cacheReadPrice } : {}),
      ...(p.cacheWritePrice != null ? { cache_write_per_mtok: p.cacheWritePrice } : {}),
    };
  }
  for (const [name, p] of Object.entries(prices)) table[name] = { input_per_mtok: p.input, output_per_mtok: p.output };
  return table;
}
