import { PROVIDERS } from "@/lib/mothership/constants";
import { federationOfFields, federationProblem, type Federation } from "./federation";

/**
 * Providers the box's host gives at install (`STADEUM_MODEL_PROVIDERS`;
 * docs/models.md, "Providers given at install"): a host that pays for a
 * box's models gives it a key, and an address when the calls go somewhere
 * other than the provider itself (an upstream gateway, a company's proxy).
 *
 *   STADEUM_MODEL_PROVIDERS='[{"provider":"anthropic","key":"sk-…","url":"https://models.example.com/anthropic"}]'
 *
 * `provider` is one of the built-ins, by the gateway's name (anthropic,
 * openai, gemini, xai, openrouter); `url` is optional. Anthropic may be
 * given `federation` in place of `key`: the IDs of the rule in Anthropic's
 * console that trusts the box's gateway (models/federation.ts), none of
 * them a secret.
 *
 *   STADEUM_MODEL_PROVIDERS='[{"provider":"anthropic","federation":{"organization_id":"…","federation_rule_id":"fdrl_…","service_account_id":"svac_…","workspace_id":"wrkspc_…"}}]'
 *
 * Upkeep writes each into the gateway (models/providers.ts,
 * applyGivenProviders), and the Models page shows it as given and never
 * changes it. An entry that cannot be read is left out, with a line in the
 * log.
 */
export type GivenProvider = {
  /** The gateway's name for the provider. */
  id: string;
  /** Where the provider's calls go instead of the provider itself: a root, without a trailing slash. */
  url?: string;
} & ({ key: string; federation?: undefined } | { key?: undefined; federation: Federation });

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
    const e = (entry ?? {}) as { provider?: unknown; key?: unknown; url?: unknown; federation?: unknown };
    const id = typeof e.provider === "string" ? e.provider.trim() : "";
    const key = typeof e.key === "string" ? e.key.trim() : "";
    const url = typeof e.url === "string" ? e.url.trim().replace(/\/+$/, "") : "";
    const fed = e.federation && typeof e.federation === "object" ? (e.federation as Record<string, unknown>) : undefined;
    const federation = fed
      ? federationOfFields({ organizationId: fed.organization_id, ruleId: fed.federation_rule_id, serviceAccountId: fed.service_account_id, workspaceId: fed.workspace_id })
      : undefined;
    const problem = !builtin.has(id)
      ? `"${id}" is not one of ${[...builtin].join(", ")}`
      : federation && id !== "anthropic"
        ? "only anthropic can be given federation"
        : federation && e.key !== undefined
          ? "it has both a key and federation"
          : federation && e.url !== undefined
            ? "federation takes no url: the gateway's identity token goes to Anthropic itself"
          : federation
            ? federationProblem(federation)?.replace(/\.$/, "")
            : !key || /\s/.test(key)
              ? "it has no key"
              : undefined;
    const later =
      problem ??
      (url && !/^https?:\/\/[^\s/]+/.test(url) ? "its url is not http(s)" : given.has(id) ? `${id} is given twice` : undefined);
    if (later) {
      console.warn(`[models] STADEUM_MODEL_PROVIDERS entry ${i + 1} left out: ${later}.`);
      continue;
    }
    given.set(id, federation ? { id, federation, ...(url ? { url } : {}) } : { id, key, ...(url ? { url } : {}) });
  }
  return [...given.values()];
}

/** The gateway's names of the given providers. */
export const givenIds = (): Set<string> => new Set(givenProviders().map((g) => g.id));

/** What an admin reads when they try to change a given provider. */
export const GIVEN_REFUSAL = "This box’s host gives this provider’s key: it can’t be changed here.";
