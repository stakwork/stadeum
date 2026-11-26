import { createHash, randomBytes } from "node:crypto";
import type { ApiKey, User } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Keys for the box's HTTP API (`/api/v1/*`). A key is `stk_` and 32 random
 * bytes, base64url. Only its SHA-256 is stored (a key this random needs no
 * slow hash), with a short prefix to tell keys apart. The secret is
 * returned once, by `createApiKey`. A key belongs to the box (its one
 * organisation) and to the admin who made it; revoking deletes it.
 */

export const API_KEY_SCOPES = ["read", "read_write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const isApiKeyScope = (s: unknown): s is ApiKeyScope => typeof s === "string" && (API_KEY_SCOPES as readonly string[]).includes(s);
export const scopeLabel: Record<ApiKeyScope, string> = { read: "Read only", read_write: "Read and write" };

export const API_KEY_PREFIX = "stk_";
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;
export const MAX_NAME_LENGTH = 60;

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) };
}

export type KeyChange<T = object> = ({ ok: true } & T) | { ok: false; reason: "invalid-name" | "invalid-scope" | "not-found" };

export async function createApiKey(
  me: Pick<User, "id">,
  input: { name: string; scope: string },
): Promise<KeyChange<{ key: string; record: ApiKey }>> {
  const name = input.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: "invalid-name" };
  if (!isApiKeyScope(input.scope)) return { ok: false, reason: "invalid-scope" };
  const { key, prefix, hash } = generateApiKey();
  const record = await db.apiKey.create({ data: { name, prefix, hash, scope: input.scope, createdById: me.id } });
  return { ok: true, key, record };
}

export type ApiKeyListing = Pick<ApiKey, "id" | "name" | "prefix" | "scope" | "createdAt" | "lastUsedAt"> & {
  createdBy: { name: string | null; email: string };
};

/** Every key of the box, newest first. Never the hash. */
export function listApiKeys(): Promise<ApiKeyListing[]> {
  return db.apiKey.findMany({
    select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true, createdBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiKey(id: string): Promise<KeyChange> {
  const { count } = await db.apiKey.deleteMany({ where: { id } });
  return count ? { ok: true } : { ok: false, reason: "not-found" };
}

/** The key a secret is, if it is one: its scope and who made it. Marks it used. */
export async function resolveApiKey(secret: string): Promise<{ id: string; scope: ApiKeyScope; createdById: string } | null> {
  if (!secret.startsWith(API_KEY_PREFIX)) return null;
  const row = await db.apiKey.findUnique({ where: { hash: hashApiKey(secret) } });
  if (!row || !isApiKeyScope(row.scope)) return null;
  await db.apiKey.updateMany({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { id: row.id, scope: row.scope, createdById: row.createdById };
}
