import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/crypto";
import type { BifrostClient, ProviderConfigInput } from "./bifrost-client";
import { BifrostHttpError } from "./http";
import { governanceClient } from "./admin-credentials";
import {
  DEFAULT_BUDGET_RESET_DURATION,
  DEFAULT_CUSTOMER_BUDGET_USD,
  DEFAULT_CUSTOMER_RATE_LIMIT,
  DEFAULT_PROVIDERS,
} from "./constants";
import { withLock } from "./lock";
import type { BifrostCustomer, BifrostProvider, BifrostProviderConfig, BifrostVirtualKey } from "./types";

/**
 * One Bifrost customer + virtual key per person, both named after the
 * actor. Ported from Hive `reconciler.ts:288-573` (ensureCustomer,
 * ensureVirtualKey, desiredProviders, topUpProviderGrants) and
 * `reconciler.ts:736-754`.
 */

export interface VirtualKeyResult {
  customerId: string;
  vkId: string;
  vkValue: string;
  created: boolean;
}

export function ensureVirtualKey(user: { id: string; actor: string }): Promise<VirtualKeyResult> {
  return withLock(`vk:${user.id}`, async () => {
    const client = await governanceClient();
    const cached = await db.mothershipUser.findUnique({ where: { userId: user.id } });
    if (cached?.customerId && cached.vkId && cached.vkValueEnc) {
      // Confirm the gateway still has it; a wiped gateway volume would otherwise
      // leave us pushing a dead key forever.
      try {
        const { virtual_key } = await client.getVirtualKey(cached.vkId);
        if (virtual_key?.value) {
          return {
            customerId: cached.customerId,
            vkId: cached.vkId,
            vkValue: decryptField("vkValue", cached.vkValueEnc),
            created: false,
          };
        }
      } catch (err) {
        if (!(err instanceof BifrostHttpError && err.status === 404)) throw err;
      }
    }

    const providers = await desiredProviders(client);
    const customer = await ensureCustomer(client, user.actor);
    const { virtualKey, created } = await ensureVk(client, user.actor, customer.id, providers);
    const data = {
      customerId: customer.id,
      vkId: virtualKey.id,
      vkValueEnc: encryptField("vkValue", virtualKey.value),
    };
    await db.mothershipUser.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return { customerId: customer.id, vkId: virtualKey.id, vkValue: virtualKey.value, created };
  });
}

export async function ensureCustomer(client: BifrostClient, name: string): Promise<BifrostCustomer> {
  const existing = await findExactCustomer(client, name);
  if (existing) return existing;
  try {
    const created = await client.createCustomer({
      name,
      budget: { max_limit: DEFAULT_CUSTOMER_BUDGET_USD, reset_duration: DEFAULT_BUDGET_RESET_DURATION },
      rate_limit: DEFAULT_CUSTOMER_RATE_LIMIT,
    });
    return created.customer;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const readback = await findExactCustomer(client, name);
      if (readback) return readback;
    }
    throw err;
  }
}

async function findExactCustomer(client: BifrostClient, name: string): Promise<BifrostCustomer | null> {
  // `search` is a substring match.
  const list = await client.listCustomers({ search: name, limit: 50 });
  const exact = (list.customers ?? []).filter((c) => c.name === name);
  return exact.length ? pickOldest(exact) : null;
}

export async function ensureVk(
  client: BifrostClient,
  name: string,
  customerId: string,
  providers: BifrostProvider[],
): Promise<{ virtualKey: BifrostVirtualKey; created: boolean }> {
  const existing = await findExactVirtualKey(client, name, customerId);
  if (existing) {
    try {
      await topUpProviderGrants(client, existing, providers);
    } catch (err) {
      console.warn(`[mothership] VK provider top-up failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { virtualKey: existing, created: false };
  }
  try {
    const created = await client.createVirtualKey({
      name,
      description: `stadeum ${name}`,
      customer_id: customerId,
      provider_configs: providers.map((provider) => ({ provider, allowed_models: ["*"], key_ids: ["*"] })),
    });
    return { virtualKey: created.virtual_key, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const readback = await findExactVirtualKey(client, name, customerId);
      if (readback) return { virtualKey: readback, created: false };
    }
    throw err;
  }
}

async function findExactVirtualKey(client: BifrostClient, name: string, customerId: string) {
  const list = await client.listVirtualKeys({ search: name, customer_id: customerId, limit: 50 });
  const exact = (list.virtual_keys ?? []).filter((vk) => vk.name === name && vk.customer_id === customerId);
  return exact.length ? pickOldest(exact) : null;
}

/** DEFAULT_PROVIDERS ∩ what the gateway has configured; all of them when unknown. */
export async function desiredProviders(client: BifrostClient): Promise<BifrostProvider[]> {
  let configured: Set<string>;
  try {
    const res = await client.listProviders();
    configured = new Set((res.providers ?? []).map((p) => p.name));
  } catch {
    return DEFAULT_PROVIDERS;
  }
  const desired = DEFAULT_PROVIDERS.filter((p) => configured.has(p));
  return desired.length ? desired : DEFAULT_PROVIDERS;
}

/** Grant any missing providers. The PUT replaces the whole set, so existing configs are re-sent. */
async function topUpProviderGrants(client: BifrostClient, vk: BifrostVirtualKey, desired: BifrostProvider[]) {
  const existing = vk.provider_configs;
  if (!Array.isArray(existing) || existing.some((pc) => pc.id == null)) return;
  const have = new Set(existing.map((pc) => pc.provider));
  const missing = desired.filter((p) => !have.has(p));
  if (!missing.length) return;
  await client.updateVirtualKey(vk.id, {
    provider_configs: [
      ...existing.map(carryProviderConfig),
      ...missing.map((provider) => ({ provider, allowed_models: ["*"], key_ids: ["*"] })),
    ],
  });
}

function carryProviderConfig(pc: BifrostProviderConfig): ProviderConfigInput {
  return {
    id: pc.id,
    provider: pc.provider,
    allowed_models: pc.allowed_models ?? [],
    blacklisted_models: pc.blacklisted_models ?? [],
    weight: pc.weight ?? undefined,
    key_ids: pc.allow_all_keys
      ? ["*"]
      : (pc.keys ?? []).map((k) => k.key_id).filter((id): id is string => typeof id === "string"),
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    err instanceof BifrostHttpError &&
    err.status === 400 &&
    /duplicate key|already exists|UNIQUE constraint/i.test(err.message)
  );
}

function pickOldest<T extends { created_at: string }>(items: T[]): T {
  return items.reduce((oldest, cur) => (cur.created_at < oldest.created_at ? cur : oldest));
}
