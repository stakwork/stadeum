import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, ecdsaPublicKey, ed25519PublicKey, hexToBytes } from "gatekey";

import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/crypto";
import { env } from "@/lib/env";
import { MACAROON_ORG_ID_PREFIX } from "./constants";
import { withLock } from "./lock";

/**
 * Org (secp256k1) and per-person (ed25519) macaroon keys, custodial,
 * private halves AES-256-GCM encrypted at rest. Ported from Hive
 * `macaroon-org-keys.ts:114-123` and `macaroon-user-keys.ts:125-128`.
 */

export interface OrgKeys {
  orgId: string;
  pubkey: string;
  privkey: Uint8Array;
  created: boolean;
}

export interface UserKeys {
  pubkey: string;
  privkey: Uint8Array;
  created: boolean;
}

export const macaroonOrgId = () => `${MACAROON_ORG_ID_PREFIX}${env.orgSlug()}`;

export class OrgKeyFileError extends Error {}

/** `/org/org-key.json`, v1, as written by `stack/bootstrap/org-identity.mjs`. */
interface OrgKeyFile {
  v: 1;
  org_id: string;
  realm_id: string;
  alg: "secp256k1";
  pubkey: string;
  privkey_enc: string;
  created_at: string;
}

/**
 * Read the stack's org key. The private half is checked against the public
 * one, so a key encrypted under another STADEUM_ENCRYPTION_KEY, or a file
 * edited by hand, fails here rather than at the gateway.
 */
export async function readOrgKeyFile(path: string): Promise<OrgKeys> {
  let file: OrgKeyFile;
  try {
    file = JSON.parse(await readFile(path, "utf8")) as OrgKeyFile;
  } catch (err) {
    throw new OrgKeyFileError(`org key file ${path} is missing or unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (file.v !== 1 || file.alg !== "secp256k1" || !file.org_id || !/^0[23][0-9a-f]{64}$/i.test(file.pubkey ?? "")) {
    throw new OrgKeyFileError(`org key file ${path} is not a v1 secp256k1 identity`);
  }
  let privkey: Uint8Array;
  try {
    privkey = hexToBytes(decryptField("orgPrivkey", file.privkey_enc));
  } catch {
    throw new OrgKeyFileError(`org key file ${path} does not decrypt with STADEUM_ENCRYPTION_KEY`);
  }
  if (bytesToHex(ecdsaPublicKey(privkey)) !== file.pubkey.toLowerCase()) {
    throw new OrgKeyFileError(`org key file ${path}: the private key does not match pubkey`);
  }
  return { orgId: file.org_id, pubkey: file.pubkey.toLowerCase(), privkey, created: false };
}

/** 32-byte private, 33-byte compressed public (what the gateway's trust registry takes). */
export function generateOrgKeypair(): { privkey: Uint8Array; pubkey: string } {
  const privkey = secp256k1.utils.randomPrivateKey();
  return { privkey, pubkey: bytesToHex(ecdsaPublicKey(privkey)) };
}

/** Any 32 random bytes is a valid ed25519 seed (RFC 8032 §5.1.5). */
export function generateUserKeypair(): { privkey: Uint8Array; pubkey: string } {
  const privkey = new Uint8Array(randomBytes(32));
  return { privkey, pubkey: bytesToHex(ed25519PublicKey(privkey)) };
}

/**
 * The org key. With STADEUM_ORG_KEY_FILE set (the stack), it is read from
 * that file and never generated here; the Org row mirrors it for the status
 * page. Without it (local runs against fakes, tests), one is generated and
 * kept in the database as before.
 */
export function ensureOrgKeys(): Promise<OrgKeys> {
  return withLock("org-keys", async () => {
    const keyFile = env.orgKeyFile();
    if (keyFile) {
      const keys = await readOrgKeyFile(keyFile);
      const row = await db.org.findUnique({ where: { id: "org" } });
      if (row?.orgPubkey !== keys.pubkey || row?.macaroonOrgId !== keys.orgId) {
        const data = {
          macaroonOrgId: keys.orgId,
          orgPubkey: keys.pubkey,
          orgPrivkeyEnc: encryptField("orgPrivkey", bytesToHex(keys.privkey)),
          trustRegisteredAt: null,
          trustedPubkey: null,
        };
        await db.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data });
      }
      return keys;
    }

    const orgId = macaroonOrgId();
    const row = await db.org.findUnique({ where: { id: "org" } });
    if (row?.orgPubkey && row.orgPrivkeyEnc && row.macaroonOrgId === orgId) {
      return {
        orgId,
        pubkey: row.orgPubkey,
        privkey: hexToBytes(decryptField("orgPrivkey", row.orgPrivkeyEnc)),
        created: false,
      };
    }
    // A slug change keeps the key: the org id is a label, the key is the trust.
    if (row?.orgPubkey && row.orgPrivkeyEnc) {
      await db.org.update({ where: { id: "org" }, data: { macaroonOrgId: orgId, trustRegisteredAt: null } });
      return {
        orgId,
        pubkey: row.orgPubkey,
        privkey: hexToBytes(decryptField("orgPrivkey", row.orgPrivkeyEnc)),
        created: false,
      };
    }
    const { privkey, pubkey } = generateOrgKeypair();
    const data = {
      macaroonOrgId: orgId,
      orgPubkey: pubkey,
      orgPrivkeyEnc: encryptField("orgPrivkey", bytesToHex(privkey)),
      trustRegisteredAt: null,
      trustedPubkey: null,
    };
    await db.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data });
    console.info(`[mothership] minted org keypair ${orgId} ${pubkey}`);
    return { orgId, pubkey, privkey, created: true };
  });
}

export function ensureUserKeys(userId: string): Promise<UserKeys> {
  return withLock(`user-keys:${userId}`, async () => {
    const row = await db.mothershipUser.findUnique({ where: { userId } });
    if (row?.userPubkey && row.userPrivkeyEnc) {
      return {
        pubkey: row.userPubkey,
        privkey: hexToBytes(decryptField("userPrivkey", row.userPrivkeyEnc)),
        created: false,
      };
    }
    const { privkey, pubkey } = generateUserKeypair();
    const data = { userPubkey: pubkey, userPrivkeyEnc: encryptField("userPrivkey", bytesToHex(privkey)) };
    await db.mothershipUser.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return { pubkey, privkey, created: true };
  });
}
