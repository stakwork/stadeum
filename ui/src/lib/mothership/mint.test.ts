import { decodeMacaroon, verify } from "gatekey";
import { describe, expect, it } from "vitest";

import { checkDelegationShape } from "@/test/strut-shape";
import { STRUT_DELEGATION_TTL_SECONDS } from "./constants";
import { buildActor } from "./actor";
import { generateOrgKeypair, generateUserKeypair } from "./keys";
import { mintDelegation, MintError } from "./mint";

function mint(overrides: Partial<Parameters<typeof mintDelegation>[0]> = {}) {
  const org = generateOrgKeypair();
  const user = generateUserKeypair();
  const input = {
    orgId: "stadeum_acme",
    orgPrivkey: org.privkey,
    orgPubkey: org.pubkey,
    actor: "ada-0f3c",
    userPubkey: user.pubkey,
    userPrivkey: user.privkey,
    ...overrides,
  };
  return { minted: mintDelegation(input), org, user, input };
}

describe("key generation", () => {
  it("makes a 33-byte compressed secp256k1 org key and a 32-byte ed25519 user key", () => {
    expect(generateOrgKeypair().pubkey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(generateUserKeypair().pubkey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mintDelegation", () => {
  it("decodes to the documented shape", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const { minted, user } = mint({ now });
    const m = decodeMacaroon(minted.token);
    expect(m.v).toBe(1);
    expect(m.org_id).toBe("stadeum_acme");
    expect(m.attenuations).toEqual([]);
    expect(m.user_authorization.user_id).toBe("ada-0f3c");
    expect(m.user_authorization.user_pubkey).toEqual({ alg: "ed25519", key: user.pubkey });
    expect(m.user_authorization.agents).toEqual(["strut-agent"]);
    expect(m.invocation.agents).toEqual(["strut-agent"]);
    expect(m.invocation.max_steps).toBe(0);
    expect(m.invocation.max_cost_usd).toBe(10_000);
    expect(m.invocation.run_id).toBe(minted.delegationId);
    expect(m.invocation.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(m.user_authorization.nonce).not.toBe(m.invocation.nonce);
    expect(Date.parse(minted.exp) - now.getTime()).toBe(STRUT_DELEGATION_TTL_SECONDS * 1000);
  });

  it("verifies against the org public key", () => {
    const { minted, org } = mint();
    const claims = verify(decodeMacaroon(minted.token), { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: org.pubkey } }, new Date());
    expect(claims).toBeTruthy();
  });

  it("does not verify against another org's key", () => {
    const { minted } = mint();
    const other = generateOrgKeypair();
    expect(() =>
      verify(decodeMacaroon(minted.token), { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: other.pubkey } }, new Date()),
    ).toThrow();
  });

  it("passes Strut's PUT /llm/delegations shape rules", () => {
    const { minted } = mint();
    const shape = checkDelegationShape(minted.token);
    expect(shape.delegationId).toBe(minted.delegationId);
    expect(shape.exp).toBe(minted.exp);
    expect(shape.ceilingUsd).toBe(10_000);
  });

  it("honours STRUT_DELEGATION_MAX_COST_USD", () => {
    process.env.STRUT_DELEGATION_MAX_COST_USD = "250";
    try {
      expect(checkDelegationShape(mint().minted.token).ceilingUsd).toBe(250);
    } finally {
      delete process.env.STRUT_DELEGATION_MAX_COST_USD;
    }
  });

  it("refuses to return a token signed with the wrong org key", () => {
    const wrong = generateOrgKeypair();
    expect(() => mint({ orgPubkey: wrong.pubkey })).toThrow(MintError);
  });
});

describe("buildActor", () => {
  it("is <email-local>-<id>, lowercased and safe", () => {
    expect(buildActor("Ada.Lovelace+x@Acme.test", "abc123")).toBe("ada-lovelace-x-abc123");
    expect(buildActor("@nolocal", "abc123")).toBe("abc123");
  });
});
