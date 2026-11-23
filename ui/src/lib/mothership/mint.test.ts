import { bytesToHex, decodeToken, encodeToken, verify } from "gatekey";
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
  it("decodes to the documented shape: the org's grant, then strut's block", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const { minted, user } = mint({ now });
    const t = decodeToken(minted.token);
    expect(t.v).toBe(2);
    expect(t.org_id).toBe("stadeum_acme");
    expect(t.blocks).toHaveLength(2);
    const [grant, own] = t.blocks;
    expect(grant!.caveats).toMatchObject({ user_id: "ada-0f3c", agents: ["strut-agent"] });
    expect(grant!.caveats.run_id).toMatch(/^ua_[0-9a-f-]{36}$/);
    expect(grant!.caveats.max_cost_usd).toBeUndefined();
    expect(grant!.next_key).toEqual({ alg: "ed25519", key: user.pubkey });
    expect(grant!.sig.alg).toBe("ecdsa-secp256k1-sha256");
    expect(own!.caveats).toMatchObject({ agent: "strut-agent", max_cost_usd: 10_000, run_id: minted.delegationId });
    expect(own!.caveats.user_id).toBeUndefined();
    // v2: a present cap must be non-zero; absent is no call-count cap.
    expect("max_steps" in own!.caveats).toBe(false);
    expect(own!.sig.alg).toBe("ed25519");
    expect(own!.caveats.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(grant!.caveats.nonce).not.toBe(own!.caveats.nonce);
    expect(Date.parse(minted.exp) - now.getTime()).toBe(STRUT_DELEGATION_TTL_SECONDS * 1000);
  });

  it("hands strut a key of its own: the person's key is not in the token", () => {
    const { minted, user } = mint();
    const t = decodeToken(minted.token);
    expect(t.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(t.proof).not.toBe(bytesToHex(user.privkey));
    expect(minted.token).not.toContain(bytesToHex(user.privkey));
  });

  it("verifies against the org public key", () => {
    const { minted, org } = mint();
    const claims = verify(minted.token, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: org.pubkey } }, new Date());
    expect(claims.user_id).toBe("ada-0f3c");
    expect(claims.agent_name).toBe("strut-agent");
    expect(claims.run_id).toBe(minted.delegationId);
    expect(claims.chain.map((c) => c.max_cost_usd)).toEqual([0, 10_000]);
  });

  it("cannot be shortened to the person's grant", () => {
    const { minted, org } = mint();
    const t = decodeToken(minted.token);
    const grantOnly = encodeToken({ ...t, blocks: t.blocks.slice(0, 1) });
    expect(() => verify(grantOnly, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: org.pubkey } }, new Date())).toThrow(
      /proof/,
    );
  });

  it("does not verify against another org's key", () => {
    const { minted } = mint();
    const other = generateOrgKeypair();
    expect(() =>
      verify(minted.token, { type: "single", key: { alg: "ecdsa-secp256k1-sha256", key: other.pubkey } }, new Date()),
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
