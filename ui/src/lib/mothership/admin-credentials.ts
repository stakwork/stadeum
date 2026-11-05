import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/crypto";
import { env } from "@/lib/env";
import { BifrostClient } from "./bifrost-client";
import { BifrostPluginClient } from "./bifrost-plugin-client";
import type { BifrostAdminCreds } from "./types";

/**
 * Bifrost `/api/*` Basic credentials. `BIFROST_ADMIN_PASS` when the
 * install set it; otherwise fetched once from `/_plugin/admin-credentials`
 * (Hive `bifrost/bootstrap.ts`) and stored encrypted.
 */

export class MothershipConfigError extends Error {}

export function requireSharedToken(): string {
  const token = env.sharedToken();
  if (!token) throw new MothershipConfigError("SHARED_API_TOKEN is not set");
  return token;
}

export function pluginClient(): BifrostPluginClient {
  return new BifrostPluginClient({ baseUrl: env.bifrostUrl(), provisioningToken: requireSharedToken() });
}

export async function bifrostAdminCreds(): Promise<BifrostAdminCreds> {
  const baseUrl = env.bifrostUrl();
  const pass = env.bifrostAdminPass();
  if (pass) return { baseUrl, adminUser: env.bifrostAdminUser(), adminPassword: pass };

  const row = await db.org.findUnique({ where: { id: "org" } });
  if (row?.bifrostAdminUser && row.bifrostAdminPassEnc) {
    return {
      baseUrl,
      adminUser: row.bifrostAdminUser,
      adminPassword: decryptField("bifrostAdminPass", row.bifrostAdminPassEnc),
    };
  }

  const creds = await pluginClient().getAdminCredentials();
  const data = {
    bifrostAdminUser: creds.admin_username,
    bifrostAdminPassEnc: encryptField("bifrostAdminPass", creds.admin_password),
  };
  await db.org.upsert({ where: { id: "org" }, create: { id: "org", ...data }, update: data });
  return { baseUrl, adminUser: creds.admin_username, adminPassword: creds.admin_password };
}

export async function governanceClient(): Promise<BifrostClient> {
  return new BifrostClient(await bifrostAdminCreds());
}
