import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DelegationsUnsupportedError, listDelegations, putDelegation, type DelegationSummary } from "@/lib/strut/client";
import { MothershipConfigError } from "./admin-credentials";
import { STRUT_DELEGATION_TTL_SECONDS } from "./constants";
import { ensureOrgKeys, ensureUserKeys } from "./keys";
import { withLock } from "./lock";
import { mintDelegation } from "./mint";
import { ensureOrgTrust } from "./trust";
import { ensureVirtualKey } from "./virtual-key";

/**
 * Make sure Strut holds a live delegation for this person. Ported from
 * Hive `strut-delegation.ts:301-505` (pushStrutDelegation,
 * ensureStrutDelegation, isPastHalfLife), with the workspace and rollout
 * gates removed: stadeum has one org and one Strut.
 */

export type DelegationStatus =
  /** Strut already holds one with more than half its life left. */
  | "fresh"
  /** Minted and pushed (first time or renewal). */
  | "pushed"
  /** Strut has no `/llm/delegations` route. */
  | "unsupported"
  /** SHARED_API_TOKEN (or similar) missing: nothing to talk to. */
  | "not-configured"
  /** Attempted and failed; the error is recorded. */
  | "failed";

export interface DelegationResult {
  status: DelegationStatus;
  actor: string;
  exp?: string;
  delegationId?: string;
  error?: string;
}

export interface DelegationUser {
  id: string;
  actor: string;
}

/** Mint and push unconditionally. Throws on failure. */
export async function pushDelegation(user: DelegationUser): Promise<DelegationSummary> {
  try {
    await ensureOrgTrust();
  } catch (err) {
    // As in Hive: the gateway may still accept the macaroon (shadow mode), so carry on.
    console.warn(`[mothership] trust reconcile failed before push: ${err instanceof Error ? err.message : String(err)}`);
  }
  const vk = await ensureVirtualKey(user);
  const [org, keys] = await Promise.all([ensureOrgKeys(), ensureUserKeys(user.id)]);
  const minted = mintDelegation({
    orgId: org.orgId,
    orgPrivkey: org.privkey,
    orgPubkey: org.pubkey,
    actor: user.actor,
    userPubkey: keys.pubkey,
    userPrivkey: keys.privkey,
  });
  // The gateway ROOT: Strut hands it to aieo, which appends each provider's path.
  return putDelegation(user.actor, { macaroon: minted.token, apiKey: vk.vkValue, baseUrl: env.bifrostUrl() });
}

/**
 * One `GET /llm/delegations`; mint + push only when missing or past half
 * its life. Never throws. The outcome is recorded on the person's
 * MothershipUser row for their page.
 */
export function ensureDelegation(user: DelegationUser, opts: { now?: Date; force?: boolean } = {}): Promise<DelegationResult> {
  return withLock(`delegation:${user.id}`, async () => {
    const now = opts.now ?? new Date();
    let result: DelegationResult;
    try {
      const current = (await listDelegations()).find((d) => d.actor === user.actor);
      if (!opts.force && current && !isPastHalfLife(current.exp, now)) {
        result = { status: "fresh", actor: user.actor, exp: current.exp, delegationId: current.delegationId };
      } else {
        const pushed = await pushDelegation(user);
        result = { status: "pushed", actor: user.actor, exp: pushed.exp, delegationId: pushed.delegationId };
      }
    } catch (err) {
      if (err instanceof DelegationsUnsupportedError) {
        result = { status: "unsupported", actor: user.actor, error: err.message };
      } else if (err instanceof MothershipConfigError) {
        result = { status: "not-configured", actor: user.actor, error: err.message };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mothership] delegation for ${user.actor} failed: ${message}`);
        result = { status: "failed", actor: user.actor, error: message };
      }
    }
    await record(user.id, result, now).catch((err) =>
      console.warn(`[mothership] could not record delegation state: ${err instanceof Error ? err.message : String(err)}`),
    );
    return result;
  });
}

async function record(userId: string, r: DelegationResult, now: Date) {
  const data = {
    delegationStatus: r.status,
    delegationError: r.error?.slice(0, 500) ?? null,
    checkedAt: now,
    ...(r.exp ? { delegationExp: new Date(r.exp), delegationId: r.delegationId ?? null } : {}),
  };
  await db.mothershipUser.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** Renew on a visit once past half the 60-day life. Unparseable = expired. */
export function isPastHalfLife(exp: string, now: Date = new Date()): boolean {
  const expMs = Date.parse(exp);
  if (!Number.isFinite(expMs)) return true;
  return expMs - now.getTime() <= (STRUT_DELEGATION_TTL_SECONDS * 1000) / 2;
}

/** Renewal-job rule: renew when within `withinMs` of exp. */
export function isWithinRenewWindow(exp: string | Date, withinMs: number, now: Date = new Date()): boolean {
  const expMs = exp instanceof Date ? exp.getTime() : Date.parse(exp);
  if (!Number.isFinite(expMs)) return true;
  return expMs - now.getTime() <= withinMs;
}
