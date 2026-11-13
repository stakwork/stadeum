import { PROVIDERS } from "@/lib/mothership/constants";

/**
 * Providers the box's host gives at install (`STADEUM_MODEL_PROVIDERS`;
 * docs/models.md, "Providers given at install"): a host that pays for a
 * box's models gives it a key, and an address when the calls go somewhere
 * other than the provider itself (an upstream gateway, a company's proxy).
 *
 *   STADEUM_MODEL_PROVIDERS='[{"provider":"anthropic","key":"sk-…","url":"https://models.example.com/anthropic"}]'
 *
 * `provider` is one of the built-ins, by the gateway's name (anthropic,
 * openai, gemini, xai, openrouter); `url` is optional. Upkeep writes each
 * into the gateway (models/providers.ts, applyGivenProviders), and the
 * Models page shows it as given and never changes it. An entry that cannot
 * be read is left out, with a line in the log.
 */
export interface GivenProvider {
  /** The gateway's name for the provider. */
  id: string;
  key: string;
  /** Where the provider's calls go instead of the provider itself: a root, without a trailing slash. */
  url?: string;
}

const builtin = new Set<string>(PROVIDERS.map((p) => p.id));

export function givenProviders(raw = process.env.STADEUM_MODEL_PROVIDERS): GivenProvider[] {
  if (!raw?.trim()) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    console.warn("[models] STADEUM_MODEL_PROVIDERS is not JSON: no provider is given.");
    return [];
  }
  if (!Array.isArray(list)) {
    console.warn("[models] STADEUM_MODEL_PROVIDERS is not a list: no provider is given.");
    return [];
  }
  const given = new Map<string, GivenProvider>();
  for (const [i, entry] of list.entries()) {
    const e = (entry ?? {}) as { provider?: unknown; key?: unknown; url?: unknown };
    const id = typeof e.provider === "string" ? e.provider.trim() : "";
    const key = typeof e.key === "string" ? e.key.trim() : "";
    const url = typeof e.url === "string" ? e.url.trim().replace(/\/+$/, "") : "";
    const problem = !builtin.has(id)
      ? `"${id}" is not one of ${[...builtin].join(", ")}`
      : !key || /\s/.test(key)
        ? "it has no key"
        : url && !/^https?:\/\/[^\s/]+/.test(url)
          ? "its url is not http(s)"
          : given.has(id)
            ? `${id} is given twice`
            : undefined;
    if (problem) {
      console.warn(`[models] STADEUM_MODEL_PROVIDERS entry ${i + 1} left out: ${problem}.`);
      continue;
    }
    given.set(id, { id, key, ...(url ? { url } : {}) });
  }
  return [...given.values()];
}

/** The gateway's names of the given providers. */
export const givenIds = (): Set<string> => new Set(givenProviders().map((g) => g.id));

/** What an admin reads when they try to change a given provider. */
export const GIVEN_REFUSAL = "This box’s host gives this provider’s key: it can’t be changed here.";
