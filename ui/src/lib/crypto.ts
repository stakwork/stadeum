import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (private keys, virtual-key values, the
 * Bifrost admin password). Key: `STADEUM_ENCRYPTION_KEY`, 32 bytes as hex
 * (64 chars) or base64.
 *
 * Wire format: `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>`. The
 * field name is bound as AAD, so a value copied into another column
 * fails to decrypt.
 */

const VERSION = "v1";

export class EncryptionConfigError extends Error {}

function key(): Buffer {
  const raw = process.env.STADEUM_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionConfigError("STADEUM_ENCRYPTION_KEY is not set");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new EncryptionConfigError("STADEUM_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
  }
  return buf;
}

export function encryptField(field: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(field, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptField(field: string, stored: string): string {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new Error(`Encrypted ${field} has an unknown format`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(field, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
