import { env } from "@/lib/env";
import type { BifrostKey, BifrostKeyInput, BifrostSecret } from "@/lib/mothership/types";

/**
 * Anthropic without a key (docs/models.md, "Anthropic without a key"). The
 * gateway is its own OIDC issuer (mothership `wrapper/identity.go`,
 * `BIFROST_IDENTITY_ISSUER` in stack/stadeum.yml): it keeps a signing key in
 * its volume, publishes the public half, and rewrites a signed identity token
 * to a file every 30 seconds. An Anthropic key with no value and an
 * `anthropic_key_config.workload_identity` pointing at that file makes the
 * gateway trade the token at Anthropic for an hour's access token, and use
 * that. Stadeum writes the key, where a pasted one goes, and holds nothing:
 * the four IDs are not secrets, and the signing key never leaves the gateway.
 */

/** Where the gateway writes its identity token (mothership `identityTokenPath`). */
export const IDENTITY_TOKEN_FILE = "/run/secrets/mothership/anthropic-identity-token";
/** The token's `sub` and `aud` (mothership `identitySubject`, `identityAudience`): what Anthropic's rule matches. */
export const IDENTITY_SUBJECT = "mothership";
export const IDENTITY_AUDIENCE = "https://api.anthropic.com";
const DISCOVERY_PATH = "/.well-known/openid-configuration";

/** Anthropic's IDs for the federation: the organization, the rule, the service account it acts as, and the workspace. */
export interface Federation {
  organizationId: string;
  ruleId: string;
  serviceAccountId: string;
  /** Only when the rule spans more than one workspace. */
  workspaceId?: string;
}

const tagged = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9]+$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The IDs, trimmed, with blanks gone. */
export function federationOfFields(f: { organizationId?: unknown; ruleId?: unknown; serviceAccountId?: unknown; workspaceId?: unknown }): Federation {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const workspaceId = s(f.workspaceId);
  return { organizationId: s(f.organizationId), ruleId: s(f.ruleId), serviceAccountId: s(f.serviceAccountId), ...(workspaceId ? { workspaceId } : {}) };
}

/** What is wrong with the IDs, in the words of Anthropic's console, or undefined. */
export function federationProblem(f: Federation): string | undefined {
  if (!UUID.test(f.organizationId)) return "The organization ID is a UUID: Anthropic’s console shows it under Organization settings.";
  if (!tagged("fdrl").test(f.ruleId)) return "The federation rule’s ID starts fdrl_.";
  if (!tagged("svac").test(f.serviceAccountId)) return "The service account’s ID starts svac_.";
  if (f.workspaceId && !tagged("wrkspc").test(f.workspaceId)) return "The workspace’s ID starts wrkspc_. Leave it blank when the rule is in one workspace.";
  return undefined;
}

/** The key's `anthropic_key_config`, as bifrost takes it. */
export function federationInput(f: Federation): NonNullable<BifrostKeyInput["anthropic_key_config"]> {
  return {
    workload_identity: {
      federation_rule_id: f.ruleId,
      organization_id: f.organizationId,
      service_account_id: f.serviceAccountId,
      ...(f.workspaceId ? { workspace_id: f.workspaceId } : {}),
      identity_source: { type: "file", path: IDENTITY_TOKEN_FILE },
    },
  };
}

const plain = (v: BifrostSecret | undefined): string => (typeof v === "string" ? v : (v?.value ?? ""));

/**
 * The federation a key uses, or undefined. A key with a value is a pasted
 * one, whatever else it holds: bifrost keeps `anthropic_key_config` when a
 * value is written over it, and the value wins (core providers/anthropic,
 * resolveKey).
 */
export function federationOfKey(k: BifrostKey): Federation | undefined {
  if (plain(k.value)) return undefined;
  const w = k.anthropic_key_config?.workload_identity;
  if (!w) return undefined;
  const f = federationOfFields({
    organizationId: plain(w.organization_id),
    ruleId: plain(w.federation_rule_id),
    serviceAccountId: plain(w.service_account_id),
    workspaceId: plain(w.workspace_id),
  });
  return f.ruleId ? f : undefined;
}

/** What the admin enters in Anthropic's console, from what the gateway publishes. */
export interface Issuer {
  /** The issuer URL: `iss`, and where Anthropic finds the key set by discovery. */
  issuer: string;
  subject: string;
  audience: string;
  /** The public key set, for a box Anthropic can't reach: pasted in instead. */
  jwks: string;
}

/**
 * The gateway's issuer, read from its own discovery document on the box's
 * network; null when it publishes none (an older gateway, or
 * BIFROST_IDENTITY_ISSUER unset). Throws only when the gateway does not
 * answer.
 */
export async function gatewayIssuer(fetcher: typeof fetch = fetch): Promise<Issuer | null> {
  const base = env.bifrostUrl();
  const get = (path: string) => fetcher(`${base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  const disc = await get(DISCOVERY_PATH);
  if (disc.status === 404) return null;
  if (!disc.ok) throw new Error(`the gateway's issuer document: ${disc.status}`);
  const doc = (await disc.json()) as { issuer?: unknown; jwks_uri?: unknown };
  if (typeof doc.issuer !== "string" || typeof doc.jwks_uri !== "string") return null;
  // The key set's URL is on the public origin; read it on the box's network.
  const keys = await get(new URL(doc.jwks_uri).pathname);
  if (!keys.ok) throw new Error(`the gateway's key set: ${keys.status}`);
  const jwks = JSON.stringify(await keys.json(), null, 2);
  return { issuer: doc.issuer, subject: IDENTITY_SUBJECT, audience: IDENTITY_AUDIENCE, jwks };
}
