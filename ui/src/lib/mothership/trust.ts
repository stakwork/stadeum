import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { pluginClient } from "./admin-credentials";
import { AGENT_CATALOG_AGENTS, AGENT_CATALOG_SOURCE, DEFAULT_REVOCATION_POLL_SECONDS } from "./constants";
import { ensureOrgKeys } from "./keys";
import { withLock } from "./lock";

/**
 * The org's standing with the gateway's trust registry.
 *
 * In the stack (STADEUM_ORG_KEY_FILE set) the `bootstrap` service registers
 * the key, so this only checks: the org is in the registry with this exact
 * pubkey, or it throws `OrgTrustError`. Without the key file (local runs
 * against fakes) it registers, as ported from Hive
 * `trust-reconciler.ts:233-375` (`syncLocked`), cached on the Org row.
 */

export type OrgTrustStatus = "cached" | "verified" | "already-registered" | "upserted";

export class OrgTrustError extends Error {}

export interface OrgTrustResult {
  status: OrgTrustStatus;
  orgId: string;
  pubkey: string;
}

const normalise = (k: string | null | undefined) => (k ?? "").trim().toLowerCase();

/** Realm = the org slug, so a multi-install future can tell gateways apart. */
const desiredRealmId = () => env.orgSlug();

/**
 * Make sure the gateway trusts this org's key. Idempotent; throws on
 * failure (phase 2's bootstrap wants to know). `force` skips the local cache.
 */
export function ensureOrgTrust(opts: { force?: boolean } = {}): Promise<OrgTrustResult> {
  return withLock("org-trust", async () => {
    const keys = await ensureOrgKeys();
    const org = await db.org.findUnique({ where: { id: "org" } });
    if (
      !opts.force &&
      !env.orgKeyFile() &&
      org?.trustRegisteredAt &&
      org.macaroonOrgId === keys.orgId &&
      normalise(org.trustedPubkey) === normalise(keys.pubkey)
    ) {
      return { status: "cached", orgId: keys.orgId, pubkey: keys.pubkey };
    }

    const client = pluginClient();
    const status = await client.getTrustStatus();

    if (env.orgKeyFile()) {
      const row = status.orgs.includes(keys.orgId) ? await client.getTrustOrg(keys.orgId) : null;
      if (!row) throw new OrgTrustError(`${keys.orgId} is not in the gateway's trust registry; run the stack's bootstrap`);
      if (normalise(row.pubkey) !== normalise(keys.pubkey)) {
        throw new OrgTrustError(`${keys.orgId} is registered with a different key; run the stack's bootstrap`);
      }
      await db.org.update({ where: { id: "org" }, data: { trustedPubkey: keys.pubkey, trustRegisteredAt: new Date() } });
      return { status: "verified", orgId: keys.orgId, pubkey: keys.pubkey };
    }

    const realm = desiredRealmId();
    if (realm && (status.realm_id ?? "") !== realm) {
      await client.setRealmId(realm);
    }

    let result: OrgTrustStatus = "upserted";
    const row = status.orgs.includes(keys.orgId) ? await client.getTrustOrg(keys.orgId) : null;
    if (row && normalise(row.pubkey) === normalise(keys.pubkey)) {
      result = "already-registered";
    } else {
      await client.upsertTrust({
        org_id: keys.orgId,
        pubkey: keys.pubkey,
        issuer_url: env.publicUrl(),
        revocation_poll_seconds: DEFAULT_REVOCATION_POLL_SECONDS,
      });
    }

    // Best-effort, as in Hive: the catalog may not be required to accept a macaroon.
    try {
      await client.seedAgentCatalog({
        source: AGENT_CATALOG_SOURCE,
        agents: AGENT_CATALOG_AGENTS.map((name) => ({ name })),
      });
    } catch (err) {
      console.warn(`[mothership] agent catalog seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await db.org.update({
      where: { id: "org" },
      data: { trustedPubkey: keys.pubkey, trustRegisteredAt: new Date() },
    });
    return { status: result, orgId: keys.orgId, pubkey: keys.pubkey };
  });
}
