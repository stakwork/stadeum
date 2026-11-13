import { governanceClient } from "@/lib/mothership/admin-credentials";
import type { BifrostClient } from "@/lib/mothership/bifrost-client";
import { KNOWN_CUSTOM, PROVIDERS, RESERVED_PROVIDER_NAMES } from "@/lib/mothership/constants";
import { BifrostHttpError } from "@/lib/mothership/http";
import type { BifrostKey, BifrostProviderEntry } from "@/lib/mothership/types";
import { GIVEN_REFUSAL, givenProviders, type GivenProvider } from "./given";

/**
 * Each provider's key, in the gateway and nowhere else (docs/models.md).
 * Stadeum writes it through bifrost's admin API and reads back only bifrost's
 * masked preview; the value is never stored here or sent to strut.
 *
 * Three kinds:
 * - built-in (PROVIDERS): in the gateway's baked config.json, with one key
 *   slot read from an env variable stadeum no longer sets. A pasted key
 *   REPLACES that slot under its name: bifrost keeps an edited key across
 *   restarts while config.json is unchanged, and a deleted one comes back
 *   empty at the next start (bifrost lib/config.go, reconcileProviderKeys).
 * - known (KNOWN_CUSTOM: Maple, Numes) and other (any OpenAI-compatible
 *   endpoint an admin names): custom providers, added in two calls (the
 *   provider, then its key: bifrost drops a key sent with the provider) and
 *   removed whole. Strut's model names start with the provider's name, and
 *   bifrost routes `<name>/<id>` on its OpenAI route to it.
 *
 * A built-in the box's host gives (models/given.ts) is written by upkeep,
 * with its address when it has one, and an admin can test it but not change
 * or remove it.
 */

export type ProviderKind = "builtin" | "known" | "other";

export interface ProviderState {
  /** bifrost's name. */
  id: string;
  /** strut's name for the provider: the first segment of its model names. */
  strut: string;
  label: string;
  kind: ProviderKind;
  /** A custom provider's address (what bifrost appends `/v1/chat/completions` to), or a given one's. */
  baseUrl?: string;
  /** The box's host gives this provider's key: the page shows it, and does not change it. */
  given?: boolean;
  /** One line about a known provider. */
  note?: string;
  /** bifrost's masked preview of the key; "" when none is set. */
  preview: string;
  /** bifrost's last check of the key (listing the provider's models with it), when it made one. */
  check?: { ok: boolean; detail?: string };
  /** A built-in the gateway has no provider for, so no key can be set. */
  missing?: boolean;
}

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

async function keysOf(client: BifrostClient, id: string): Promise<BifrostKey[] | null> {
  try {
    return (await client.listProviderKeys(id)).keys ?? [];
  } catch (err) {
    if (err instanceof BifrostHttpError && err.status === 404) return null;
    throw err;
  }
}

/** What a provider is, before its keys are read. */
type Shape = Omit<ProviderState, "preview" | "check" | "missing">;

const builtinShape = (id: string): Shape | undefined => {
  const p = PROVIDERS.find((x) => x.id === id);
  return p && { id: p.id, strut: p.strut, label: p.label, kind: "builtin" };
};
const knownShape = (id: string): Shape | undefined => {
  const p = KNOWN_CUSTOM.find((x) => x.id === id);
  return p && { id: p.id, strut: p.strut, label: p.label, kind: "known", baseUrl: p.baseUrl, note: p.note };
};
const otherShape = (e: BifrostProviderEntry): Shape => ({ id: e.name, strut: e.name, label: e.name, kind: "other", baseUrl: e.network_config?.base_url });

function stateOf(shape: Shape, keys: BifrostKey[] | null): ProviderState {
  if (keys === null) return { ...shape, preview: "", ...(shape.kind === "builtin" ? { missing: true } : {}) };
  const set = keys.find((k) => previewOf(k));
  return { ...shape, preview: set ? previewOf(set) : "", check: checkOf(set) };
}

/**
 * Every provider stadeum offers, with its key's state: the built-ins, Maple
 * and Numes (set up or not), then each other provider the gateway holds.
 * Throws when the gateway does not answer.
 */
export async function providerStates(client?: BifrostClient): Promise<ProviderState[]> {
  const c = client ?? (await governanceClient());
  const entries = (await c.listProviders()).providers ?? [];
  const has = new Set(entries.map((e) => e.name));
  const others = entries
    .filter((e) => !builtinShape(e.name) && !knownShape(e.name) && e.custom_provider_config)
    .sort((a, b) => a.name.localeCompare(b.name));
  const shapes: Shape[] = [...PROVIDERS.map((p) => builtinShape(p.id)!), ...KNOWN_CUSTOM.map((p) => knownShape(p.id)!), ...others.map(otherShape)];
  const given = new Map(givenProviders().map((g) => [g.id, g]));
  return Promise.all(
    shapes.map(async (s) => {
      const state = stateOf(s, s.kind === "known" && !has.has(s.id) ? [] : await keysOf(c, s.id));
      const g = given.get(s.id);
      return g ? { ...state, given: true, ...(g.url ? { baseUrl: g.url } : {}) } : state;
    }),
  );
}

/** strut's names of the providers that have a key. */
export const keyedProviders = (states: ProviderState[]) => new Set(states.filter((s) => s.preview).map((s) => s.strut));

/** The custom provider's address as bifrost wants it: a root, without `/v1` or a trailing slash. */
export function rootOf(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Bifrost refuses a private address (RFC 1918, a single-label docker name)
 * unless the provider allows it: Maple's proxy is `maple:8080` on this
 * box's network. Link-local stays refused whatever the flag.
 */
export function isPrivateHost(url: string): boolean {
  const host = new URL(url).hostname;
  return (
    !host.includes(".") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "127.0.0.1"
  );
}

async function ensureCustomProvider(c: BifrostClient, name: string, baseUrl: string): Promise<void> {
  if ((await keysOf(c, name)) !== null) return;
  await c.createProvider({
    provider: name,
    network_config: { base_url: baseUrl, ...(isPrivateHost(baseUrl) ? { allow_private_network: true } : {}) },
    custom_provider_config: { base_provider_type: "openai" },
  });
}

/** Write the key: replace the provider's first key (a built-in's env slot), or add one. Then bifrost checks it. */
async function writeKey(c: BifrostClient, shape: Shape, value: string): Promise<ProviderState> {
  const keys = await keysOf(c, shape.id);
  if (keys === null) throw new Error(`The gateway has no ${shape.label} provider.`);
  const slot = keys[0];
  const input = { name: slot?.name ?? `${shape.id}-key-1`, value, models: slot?.models?.length ? slot.models : ["*"], weight: slot?.weight || 1 };
  const written = slot ? await c.updateProviderKey(shape.id, slot.id, input) : await c.createProviderKey(shape.id, input);
  const checked = await c.checkProviderKey(shape.id, written.id).catch(() => written);
  return stateOf(shape, [checked, ...keys.slice(1)]);
}

async function shapeOf(c: BifrostClient, id: string): Promise<Shape | undefined> {
  const known = builtinShape(id) ?? knownShape(id);
  if (known) return known;
  const entry = ((await c.listProviders()).providers ?? []).find((e) => e.name === id && e.custom_provider_config);
  return entry && otherShape(entry);
}

/**
 * Set a provider's key. A known provider (Maple, Numes) is added to the
 * gateway first when it is not there. Throws when the gateway refuses, or
 * for a provider stadeum does not offer.
 */
export async function setProviderKey(id: string, value: string, client?: BifrostClient): Promise<ProviderState> {
  if (isGiven(id)) throw new Error(GIVEN_REFUSAL);
  const c = client ?? (await governanceClient());
  const shape = await shapeOf(c, id);
  if (!shape) throw new Error("That is not a provider stadeum offers.");
  if (shape.kind === "known") await ensureCustomProvider(c, shape.id, shape.baseUrl!);
  return writeKey(c, shape, value);
}

/** A name an Other provider may take: aieo's rule for a gateway provider (strut src/aieo/resolve.ts), not one taken. */
export function otherNameProblem(name: string): string | undefined {
  if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(name) || name.length > 40) {
    return "Name it in lowercase letters and digits, with - _ or . between words: it starts every model's name.";
  }
  if (RESERVED_PROVIDER_NAMES.has(name)) return `“${name}” is taken: pick another name.`;
  return undefined;
}

/**
 * Add an OpenAI-compatible provider: the provider, then its key (bifrost
 * drops a key sent with the provider). If the key is refused by the
 * gateway, the provider is taken back out.
 */
export async function addOtherProvider(name: string, baseUrl: string, value: string, client?: BifrostClient): Promise<ProviderState> {
  const c = client ?? (await governanceClient());
  const problem = otherNameProblem(name);
  if (problem) throw new Error(problem);
  if ((await keysOf(c, name)) !== null) throw new Error(`The gateway already has a provider named “${name}”.`);
  const root = rootOf(baseUrl);
  await c.createProvider({
    provider: name,
    network_config: { base_url: root, ...(isPrivateHost(root) ? { allow_private_network: true } : {}) },
    custom_provider_config: { base_provider_type: "openai" },
  });
  try {
    return await writeKey(c, { id: name, strut: name, label: name, kind: "other", baseUrl: root }, value);
  } catch (err) {
    await c.deleteProvider(name).catch(() => undefined);
    throw err;
  }
}

/** Ask bifrost to check the provider's key again. */
export async function checkProviderKey(id: string, client?: BifrostClient): Promise<ProviderState> {
  const c = client ?? (await governanceClient());
  const shape = await shapeOf(c, id);
  if (!shape) throw new Error("That is not a provider stadeum offers.");
  const keys = await keysOf(c, id);
  const set = keys?.find((k) => previewOf(k));
  if (!keys || !set) return stateOf(shape, keys ?? (shape.kind === "known" ? [] : null));
  const checked = await c.checkProviderKey(id, set.id);
  return stateOf(shape, keys.map((k) => (k.id === set.id ? checked : k)));
}

/**
 * Remove a provider's key. A built-in keeps its slot (its empty env slot
 * comes back at the gateway's next start); a custom provider goes whole.
 */
export async function removeProviderKey(id: string, client?: BifrostClient): Promise<void> {
  if (isGiven(id)) throw new Error(GIVEN_REFUSAL);
  const c = client ?? (await governanceClient());
  const shape = await shapeOf(c, id);
  if (!shape) throw new Error("That is not a provider stadeum offers.");
  if (shape.kind !== "builtin") {
    if ((await keysOf(c, id)) !== null) await c.deleteProvider(id);
    return;
  }
  for (const k of (await keysOf(c, id)) ?? []) {
    if (previewOf(k)) await c.deleteProviderKey(id, k.id);
  }
}

// ── given providers ─────────────────────────────────────────────────────

const isGiven = (id: string) => givenProviders().some((g) => g.id === id);

/**
 * The provider's address: the given url, or the provider's own (no
 * `base_url`). Untouched when it already is; the rest of its network
 * settings, and its concurrency, are sent back as read.
 */
async function setAddress(c: BifrostClient, g: GivenProvider): Promise<void> {
  const current = await c.getProvider(g.id);
  const net = { ...(current.network_config ?? {}) };
  const want = g.url ? rootOf(g.url) : undefined;
  if ((net.base_url || undefined) === want) return;
  delete net.base_url;
  delete net.allow_private_network;
  if (want) Object.assign(net, { base_url: want }, isPrivateHost(want) ? { allow_private_network: true } : {});
  await c.updateProvider(g.id, { network_config: net, concurrency_and_buffer_size: current.concurrency_and_buffer_size });
}

/**
 * Write each given provider into the gateway: its address, then its key,
 * which the gateway then checks. Upkeep runs it, so a gateway that lost
 * them (a restart, a restore, a hand edit) gets them back. One that fails is
 * logged and the others go on. Returns how many were written.
 */
export async function applyGivenProviders(client?: BifrostClient): Promise<number> {
  const given = givenProviders();
  if (!given.length) return 0;
  const c = client ?? (await governanceClient());
  let written = 0;
  for (const g of given) {
    try {
      await setAddress(c, g);
      await writeKey(c, builtinShape(g.id)!, g.key);
      written++;
    } catch (err) {
      console.warn(`[models] given provider ${g.id} not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return written;
}
