import { randomBytes } from "node:crypto";
import { z } from "zod";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { governanceClient, MothershipConfigError } from "./admin-credentials";
import { BifrostHttpError } from "./http";
import { desiredGrants, ensureVirtualKey } from "./virtual-key";

/**
 * A grant's key: a virtual key for a machine outside strut that strut has
 * granted model calls, such as a pod's apps (stakwork/pods PLAN.md §3.2).
 * Strut asks with the deployment key and the person's actor
 * (`/api/mothership/keys`). The key is made under that person's customer,
 * so their budget pays; it may call the org's models, as their own key
 * may; and the gateway refuses it past its own budget, the cap strut gives,
 * and after the expiry strut gives, at most a day away. Strut sends the
 * person's macaroon narrowed for the grant, and gets back the two joined,
 * `<virtual key>.<macaroon>`, which the gateway splits into its two
 * headers, and the address of the gateway's public route,
 * `mothership.<HOST>` (stack/caddy/Caddyfile). docs/models.md, "A grant's
 * key".
 *
 * The key's budget, its expiry and its deletion are what bound the machine,
 * not the macaroon's narrowing: a macaroon carries each link's HMAC, so
 * code holding it can drop strut's link and present the person's whole
 * delegation (found by strut's side, 2026-11-20). That works only beside
 * a virtual key the gateway honours, and this one stops at its budget.
 *
 * The gateway is the record: nothing is kept here. A grant's key is named
 * `grant:<name>:<random>`, which no person's own key can be (an actor has
 * no `:`), so a delete and the sweep touch nothing else.
 */

const PREFIX = "grant:";
/** The longest a grant's key lives: strut asks again for a longer grant. */
export const GRANT_KEY_MAX_HOURS = 24;
/** The budget's period: longer than a key lives, so it never refills. */
const ONCE = "1w";
/** A virtual key, as the gateway's split expects one: never a `.` (bifrost: `sk-bf-<uuid>`). */
const VIRTUAL_KEY = /^sk-bf-[A-Za-z0-9_-]+$/;
/** The gateway's page size: it clamps any larger limit to 100. */
const PAGE = 100;

/** What strut sends. */
export const grantKeyRequest = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, "name: 1 to 64 of A-Z, a-z, 0-9, '.', '_' and '-'"),
  // gatekey's encoding: base64url without padding, so never a `.`.
  macaroon: z
    .string()
    .max(16_384, "macaroon: too long")
    .regex(/^[A-Za-z0-9_-]+$/, "macaroon: unpadded base64url"),
  max_cost_usd: z.number({ message: "max_cost_usd: a number of dollars" }).positive("max_cost_usd: more than 0").finite(),
  expires_at: z.string().datetime({ offset: true, message: "expires_at: an ISO 8601 time" }),
});
export type GrantKeyRequest = z.infer<typeof grantKeyRequest>;

/** What strut gets back. */
export interface GrantKey {
  id: string;
  key: string;
  address: string;
  expires_at: string;
}

/** A refusal strut can act on: 400 for the request, 404 for the person. */
export class GrantKeyError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export const isGrantKey = (vk: { name?: string }) => !!vk.name?.startsWith(PREFIX);

export async function createGrantKey(actor: string, req: GrantKeyRequest, now = new Date()): Promise<GrantKey> {
  const expires = new Date(req.expires_at);
  if (expires.getTime() <= now.getTime()) throw new GrantKeyError(400, "expires_at: must be in the future");
  if (expires.getTime() - now.getTime() > GRANT_KEY_MAX_HOURS * 3_600_000) {
    throw new GrantKeyError(400, `expires_at: at most ${GRANT_KEY_MAX_HOURS} hours away`);
  }
  const user = await db.user.findUnique({ where: { actor }, select: { id: true, actor: true } });
  if (!user) throw new GrantKeyError(404, "no person with that actor");

  const { customerId } = await ensureVirtualKey(user);
  const client = await governanceClient();
  const grants = await desiredGrants(client);
  const { virtual_key: vk } = await client.createVirtualKey({
    name: `${PREFIX}${req.name}:${randomBytes(4).toString("hex")}`,
    description: `stadeum grant ${req.name} for ${user.actor}`,
    customer_id: customerId,
    provider_configs: grants.map((g) => ({ ...g, key_ids: ["*"] })),
    budgets: [{ max_limit: req.max_cost_usd, reset_duration: ONCE }],
    expires_at: expires.toISOString(),
  });
  if (!VIRTUAL_KEY.test(vk.value)) {
    // A key the gateway could not split from the macaroon: take it back.
    await client.deleteVirtualKey(vk.id).catch(() => {});
    throw new Error("the gateway made a virtual key its own split cannot read");
  }
  return {
    id: vk.id,
    key: `${vk.value}.${req.macaroon}`,
    address: env.mothershipUrl(),
    expires_at: vk.expires_at ?? expires.toISOString(),
  };
}

/** False when there is no grant's key by that id: gone already, or a key of another kind. */
export async function deleteGrantKey(id: string): Promise<boolean> {
  const client = await governanceClient();
  try {
    const { virtual_key: vk } = await client.getVirtualKey(id);
    if (!vk || !isGrantKey(vk)) return false;
    await client.deleteVirtualKey(vk.id);
    return true;
  } catch (err) {
    if (err instanceof BifrostHttpError && err.status === 404) return false;
    throw err;
  }
}

/**
 * Deletes every grant's key past its expiry, in case strut never released
 * it. The gateway already refuses such a key; this keeps its list short.
 * Answers how many it deleted.
 */
export async function sweepGrantKeys(now = new Date()): Promise<number> {
  const client = await governanceClient();
  const expired: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const keys = (await client.listVirtualKeys({ search: PREFIX, limit: PAGE, offset })).virtual_keys ?? [];
    for (const vk of keys) {
      if (isGrantKey(vk) && vk.expires_at && Date.parse(vk.expires_at) <= now.getTime()) expired.push(vk.id);
    }
    if (keys.length < PAGE) break;
  }
  for (const id of expired) {
    await client.deleteVirtualKey(id).catch((err) => {
      if (!(err instanceof BifrostHttpError && err.status === 404)) throw err;
    });
  }
  return expired.length;
}

/** A failure, in strut's terms: its request (400), the person (404), the gateway's setup (503), the gateway (502). */
export function grantKeyRefusal(err: unknown): Response {
  if (err instanceof GrantKeyError) return Response.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof MothershipConfigError) return Response.json({ error: message }, { status: 503 });
  console.warn(`[mothership] grant key: ${message}`);
  return Response.json({ error: `the gateway: ${message}` }, { status: 502 });
}
