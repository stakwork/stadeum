import { randomBytes, randomUUID } from "node:crypto";
import { attenuate, bytesToHex, encodeToken, signRoot, verify } from "gatekey";

import { STRUT_DELEGATION_AGENT, STRUT_DELEGATION_DEFAULT_MAX_COST_USD, STRUT_DELEGATION_TTL_SECONDS } from "./constants";

/**
 * Mint the standing Strut delegation: a macaroon v2 (gatekey 1.x, a signed
 * block chain with a proof key) of two blocks.
 *
 * - Block 0, signed by the org, grants the person: `user_id` = the actor,
 *   `agents: ["strut-agent"]`, run id `ua_<uuid>`, no cap of its own. It
 *   names the person's key as the next key.
 * - Block 1, signed by the person's key, hands strut one run: `agent:
 *   "strut-agent"`, the USD ceiling, run id = the delegation id. It names
 *   a fresh key, and the token's `proof` is that key.
 *
 * So the person's key never leaves stadeum, and strut can only append
 * blocks under its own: it cannot get block 0's grant back. No
 * `max_steps`: in v2 a present cap must be non-zero, and absent means no
 * cap. 60-day life. Pure: keys in, token out.
 *
 * Every token is verified against the org pubkey before it is returned,
 * so a key mix-up fails here rather than at the gateway.
 */

export interface MintInput {
  orgId: string;
  orgPrivkey: Uint8Array;
  orgPubkey: string;
  /** Block 0's `user_id` = Strut actor = Bifrost customer name. */
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

  const grant = signRoot(
    input.orgId,
    { run_id: `ua_${randomUUID()}`, user_id: input.actor, agents: [STRUT_DELEGATION_AGENT], iat, exp, nonce: nonce() },
    { alg: "ed25519", key: input.userPubkey },
    { alg: "ecdsa-secp256k1-sha256", priv: input.orgPrivkey },
  );
  const token = encodeToken(
    attenuate(
      { v: 2, org_id: input.orgId, blocks: [grant], proof: bytesToHex(input.userPrivkey) },
      {
        run_id: runId,
        agent: STRUT_DELEGATION_AGENT,
        max_cost_usd: input.maxCostUsd ?? delegationMaxCostUsd(),
        iat,
        exp,
        nonce: nonce(),
      },
    ),
  );

  try {
    verify(token, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: input.orgPubkey } }, now);
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
