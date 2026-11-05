import { PROVIDERS } from "@/lib/mothership/constants";
import type { StrutModelCatalog } from "@/lib/strut/client";

/**
 * Which models people may use, as pure functions over what the admin saved,
 * strut's catalog and the providers that have a key (docs/models.md, "The
 * levels"). Names are strut's canonical `provider/id`; the gateway names the
 * same provider its own way (`google` is bifrost's `gemini`).
 */

export interface ModelSettings {
  /** The admin's list. Null until they save one. */
  models: string[] | null;
  defaultModel: string | null;
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

/** A canonical name an admin may put on the list: a provider stadeum offers and a plausible id. */
export function isModelName(name: string): boolean {
  const s = splitName(name);
  return !!s && name.length <= 200 && PROVIDERS.some((p) => p.strut === s.provider) && MODEL_ID_RE.test(s.modelId.replace(/^~/, ""));
}

/**
 * The Models form, checked: the ticked models plus one typed in, and the
 * default among them. Errors are what the admin reads.
 */
export function parseModelsForm(input: { ticked: string[]; other: string; default: string }): ModelSettings | { error: string } {
  const other = input.other.trim();
  if (other && !isModelName(other)) {
    return { error: `“${other}” is not a model name stadeum knows. Write it as provider/id, e.g. openrouter/deepseek/deepseek-v4.` };
  }
  const models = unique([...input.ticked.map((t) => t.trim()).filter(Boolean), ...(other ? [other] : [])]);
  const bad = models.find((m) => !isModelName(m));
  if (bad) return { error: `“${bad}” is not a model name stadeum knows.` };
  if (models.length === 0) return { error: "Allow at least one model." };
  const defaultModel = input.default.trim();
  if (!models.includes(defaultModel)) return { error: "Choose the default from the allowed models." };
  return { models, defaultModel };
}
