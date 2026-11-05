import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bytesToHex } from "gatekey";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { encryptField } from "@/lib/crypto";
import { db } from "@/lib/db";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { ensureOrgKeys, generateOrgKeypair, OrgKeyFileError } from "./keys";
import { ensureOrgTrust, OrgTrustError } from "./trust";

/** A file in the exact shape `stack/bootstrap/org-identity.mjs` writes. */
function writeKeyFile(overrides: Record<string, unknown> = {}) {
  const { privkey, pubkey } = generateOrgKeypair();
  const dir = mkdtempSync(path.join(tmpdir(), "org-key-"));
  const file = path.join(dir, "org-key.json");
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      org_id: "stadeum_acme",
      realm_id: "acme",
      alg: "secp256k1",
      pubkey,
      privkey_enc: encryptField("orgPrivkey", bytesToHex(privkey)),
      created_at: new Date().toISOString(),
      ...overrides,
    }),
  );
  return { file, pubkey };
}

let fake: FakeStack;
beforeAll(async () => {
  fake = await startFakeStack();
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    BIFROST_URL: fake.bifrostUrl,
    STRUT_URL: fake.strutUrl,
    STADEUM_ORG_SLUG: "acme",
  });
});
afterEach(async () => {
  delete process.env.STADEUM_ORG_KEY_FILE;
  await db.org.deleteMany();
  fake.state.trust.clear();
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});

describe("org key from the stack's file", () => {
  it("uses the file's key and never generates one", async () => {
    const { file, pubkey } = writeKeyFile();
    process.env.STADEUM_ORG_KEY_FILE = file;
    const keys = await ensureOrgKeys();
    expect(keys.pubkey).toBe(pubkey);
    expect(keys.orgId).toBe("stadeum_acme");
    expect(keys.created).toBe(false);
    expect((await db.org.findUniqueOrThrow({ where: { id: "org" } })).orgPubkey).toBe(pubkey);
  });

  it("refuses a missing file, a wrong key, or a mismatched pubkey", async () => {
    process.env.STADEUM_ORG_KEY_FILE = "/nonexistent/org-key.json";
    await expect(ensureOrgKeys()).rejects.toBeInstanceOf(OrgKeyFileError);

    process.env.STADEUM_ORG_KEY_FILE = writeKeyFile({ privkey_enc: "v1:AAAA:AAAA:AAAA" }).file;
    await expect(ensureOrgKeys()).rejects.toThrow(/does not decrypt/);

    process.env.STADEUM_ORG_KEY_FILE = writeKeyFile({ pubkey: generateOrgKeypair().pubkey }).file;
    await expect(ensureOrgKeys()).rejects.toThrow(/does not match/);
  });

  it("trust is a check: fails when bootstrap has not registered, passes when it has, never registers", async () => {
    const { file, pubkey } = writeKeyFile();
    process.env.STADEUM_ORG_KEY_FILE = file;
    await expect(ensureOrgTrust()).rejects.toBeInstanceOf(OrgTrustError);
    expect(fake.state.trust.size).toBe(0);

    fake.state.trust.set("stadeum_acme", { org_id: "stadeum_acme", pubkey, issuer_url: "", revocation_poll_seconds: 60 });
    expect((await ensureOrgTrust()).status).toBe("verified");

    fake.state.trust.set("stadeum_acme", { org_id: "stadeum_acme", pubkey: generateOrgKeypair().pubkey, issuer_url: "", revocation_poll_seconds: 60 });
    await expect(ensureOrgTrust()).rejects.toThrow(/different key/);
  });
});
