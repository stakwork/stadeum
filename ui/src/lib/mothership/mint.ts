import { randomBytes, randomUUID } from "node:crypto";
import {
  bytesToHex,
  decodeMacaroon,
  encodeMacaroon,
  signInvocation,
  signUserAuthorizationSingle,
  verify,
} from "gatekey";

import { STRUT_DELEGATION_AGENT, STRUT_DELEGATION_DEFAULT_MAX_COST_USD, STRUT_DELEGATION_TTL_SECONDS } from "./constants";

/**
 * Mint the standing Strut delegation: an org-signed user authorization
 * plus a user-signed invocation for `strut-agent`, `max_steps: 0`, a USD
 * ceiling and a 60-day life. Ported from Hive `macaroon-issuer.ts:154-305`
 * and `strut-delegation.ts:253-272`. Pure: keys in, token out.
 *
 * Every token is verified against the org pubkey before it is returned,
 * so a key mix-up fails here rather than at the gateway.
 */

export interface MintInput {
  orgId: string;
  orgPrivkey: Uint8Array;
  orgPubkey: string;
  /** Macaroon `user_id` = Strut actor = Bifrost customer name. */
  actor: string;
  userPubkey: string;
  userPrivkey: Uint8Array;
  maxCostUsd?: number;
  ttlSeconds?: number;
  now?: Date;
}

export interface MintedDelegation {
  token: string;
  delegationId: string;
  exp: string;
}

export class MintError extends Error {}

export function mintDelegation(input: MintInput): MintedDelegation {
  const now = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? STRUT_DELEGATION_TTL_SECONDS;
  const iat = now.toISOString();
  const exp = new Date(now.getTime() + ttl * 1000).toISOString();
  const runId = randomUUID();
  const agents = [STRUT_DELEGATION_AGENT];

  const ua = signUserAuthorizationSingle(
    {
      user_id: input.actor,
      user_pubkey: { alg: "ed25519", key: input.userPubkey },
      agents,
      iat,
      exp,
      nonce: nonce(),
    },
    input.orgPrivkey,
  );
  const invocation = signInvocation(
    {
      agents,
      run_id: runId,
      max_cost_usd: input.maxCostUsd ?? delegationMaxCostUsd(),
      // 0 = no call-count cap; any positive number would be wider than Strut can narrow under.
      max_steps: 0,
      iat,
      exp,
      nonce: nonce(),
    },
    input.userPrivkey,
  );
  const token = encodeMacaroon({ v: 1, org_id: input.orgId, user_authorization: ua, invocation, attenuations: [] });

  try {
    verify(decodeMacaroon(token), { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: input.orgPubkey } }, now);
  } catch (err) {
    throw new MintError(`minted macaroon failed self-verification: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { token, delegationId: runId, exp };
}

/** `STRUT_DELEGATION_MAX_COST_USD` when it is a positive number, else the default. */
export function delegationMaxCostUsd(): number {
  const raw = process.env.STRUT_DELEGATION_MAX_COST_USD?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : STRUT_DELEGATION_DEFAULT_MAX_COST_USD;
}

/** 16 random bytes, hex — the nonce shape the gateway expects. */
const nonce = () => bytesToHex(new Uint8Array(randomBytes(16)));
