import { governanceClient } from "@/lib/mothership/admin-credentials";
import type { BifrostClient } from "@/lib/mothership/bifrost-client";
import { PROVIDERS } from "@/lib/mothership/constants";
import { BifrostHttpError } from "@/lib/mothership/http";
import type { BifrostKey } from "@/lib/mothership/types";

/**
 * Each provider's key, in the gateway and nowhere else (docs/models.md).
 * Stadeum writes it through bifrost's admin API and reads back only bifrost's
 * masked preview; the value is never stored here or sent to strut.
 *
 * Each of these providers is in the gateway's baked config.json with one key
 * slot read from an env variable stadeum no longer sets. A pasted key
 * REPLACES that slot under its name: bifrost keeps an edited key across
 * restarts while config.json is unchanged, and a deleted one comes back
 * empty at the next start (bifrost lib/config.go, reconcileProviderKeys).
 */

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export interface ProviderState {
  id: ProviderId;
  /** strut's name for the provider: the first segment of its model names. */
  strut: string;
  label: string;
  /** bifrost's masked preview of the key; "" when none is set. */
  preview: string;
  /** bifrost's last check of the key (listing the provider's models with it), when it made one. */
  check?: { ok: boolean; detail?: string };
  /** The gateway has no such provider, so no key can be set. */
  missing?: boolean;
}

export const isProviderId = (id: string): id is ProviderId => PROVIDERS.some((p) => p.id === id);

const previewOf = (k: BifrostKey): string => (typeof k.value === "string" ? k.value : (k.value?.value ?? ""));

/**
 * The provider's own sentence out of bifrost's description, which wraps the
 * provider's body: `provider API error: {"code":…,"error":"Incorrect API key provided…"}`.
 */
export function providerSays(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const body = description.match(/\{.*\}/s)?.[0];
  if (body) {
    try {
      const j = JSON.parse(body) as { error?: unknown; message?: unknown };
      const said = typeof j.error === "string" ? j.error : (j.error as { message?: unknown } | undefined)?.message ?? j.message;
      if (typeof said === "string" && said) return said.slice(0, 300);
    } catch {
      // Not JSON: bifrost's words as they are.
    }
  }
  return description.slice(0, 300);
}

function checkOf(k: BifrostKey | undefined): ProviderState["check"] {
  if (k?.status === "success") return { ok: true };
  if (k?.status === "list_models_failed") return { ok: false, detail: providerSays(k.description) };
  return undefined;
}

async function keysOf(client: BifrostClient, id: ProviderId): Promise<BifrostKey[] | null> {
  try {
    return (await client.listProviderKeys(id)).keys ?? [];
  } catch (err) {
    if (err instanceof BifrostHttpError && err.status === 404) return null;
    throw err;
  }
}

function stateOf(id: ProviderId, keys: BifrostKey[] | null): ProviderState {
  const p = PROVIDERS.find((x) => x.id === id)!;
  if (keys === null) return { id, strut: p.strut, label: p.label, preview: "", missing: true };
  const set = keys.find((k) => previewOf(k));
  return { id, strut: p.strut, label: p.label, preview: set ? previewOf(set) : "", check: checkOf(set) };
}

/** Every provider stadeum offers, with its key's state. Throws when the gateway does not answer. */
export async function providerStates(client?: BifrostClient): Promise<ProviderState[]> {
  const c = client ?? (await governanceClient());
  return Promise.all(PROVIDERS.map(async (p) => stateOf(p.id, await keysOf(c, p.id))));
}

/** strut's names of the providers that have a key. */
export const keyedProviders = (states: ProviderState[]) => new Set(states.filter((s) => s.preview).map((s) => s.strut));

/**
 * Set the provider's key: replace its slot (the first key bifrost holds for
 * it), or add one when it has none. Then bifrost checks it. Throws when the
 * gateway refuses.
 */
export async function setProviderKey(id: ProviderId, value: string, client?: BifrostClient): Promise<ProviderState> {
  const c = client ?? (await governanceClient());
  const keys = await keysOf(c, id);
  if (keys === null) throw new Error(`The gateway has no ${id} provider.`);
  const slot = keys[0];
  const input = { name: slot?.name ?? `${id}-key-1`, value, models: slot?.models?.length ? slot.models : ["*"], weight: slot?.weight || 1 };
  const written = slot ? await c.updateProviderKey(id, slot.id, input) : await c.createProviderKey(id, input);
  const checked = await c.checkProviderKey(id, written.id).catch(() => written);
  return stateOf(id, [checked, ...keys.slice(1)]);
}

/** Ask bifrost to check the provider's key again. */
export async function checkProviderKey(id: ProviderId, client?: BifrostClient): Promise<ProviderState> {
  const c = client ?? (await governanceClient());
  const keys = await keysOf(c, id);
  const set = keys?.find((k) => previewOf(k));
  if (!keys || !set) return stateOf(id, keys);
  const checked = await c.checkProviderKey(id, set.id);
  return stateOf(id, keys.map((k) => (k.id === set.id ? checked : k)));
}

/** Delete every key the provider has a value for. Its empty env slot comes back at the gateway's next start. */
export async function removeProviderKey(id: ProviderId, client?: BifrostClient): Promise<void> {
  const c = client ?? (await governanceClient());
  for (const k of (await keysOf(c, id)) ?? []) {
    if (previewOf(k)) await c.deleteProviderKey(id, k.id);
  }
}
