/**
 * Every setting stadeum-ui reads, in one place. Read at call time (not
 * module load) so tests and phase-2 bootstrap can set env late.
 */

const trimmed = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

const stripSlash = (u: string) => u.replace(/\/+$/, "");

export const env = {
  devLogin: () => process.env.STADEUM_DEV_LOGIN === "1",
  allowedDomains: (): string[] =>
    (trimmed("STADEUM_ALLOWED_DOMAINS") ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  orgSlug: () => trimmed("STADEUM_ORG_SLUG") ?? "org",
  /** Shown beside the wordmark and in sign-in copy. */
  orgName: () => trimmed("STADEUM_ORG_NAME") ?? trimmed("STADEUM_ORG_SLUG") ?? "Your organisation",
  sharedToken: () => trimmed("SHARED_API_TOKEN"),
  /** The org identity file the stack's bootstrap writes (docs/mothership-spec.md). Set = the stack owns the key. */
  orgKeyFile: () => trimmed("STADEUM_ORG_KEY_FILE"),
  bifrostUrl: () => stripSlash(trimmed("BIFROST_URL") ?? "http://bifrost.sphinx:8181"),
  bifrostAdminUser: () => trimmed("BIFROST_ADMIN_USER") ?? "admin",
  bifrostAdminPass: () => trimmed("BIFROST_ADMIN_PASS"),
  mcpUrl: () => stripSlash(trimmed("MCP_URL") ?? "http://repo2graph.sphinx:3355"),
  /** Where the browser loads a hosted Strut app from. Falls back to MCP_URL. */
  mcpPublicUrl: () => stripSlash(trimmed("MCP_PUBLIC_URL") ?? env.mcpUrl()),
  neo4jHttpUrl: () => stripSlash(trimmed("NEO4J_HTTP_URL") ?? "http://neo4j.sphinx:7474"),
  /** stadeum-ui's own public origin: the Strut embed origin and the trust issuer URL. */
  publicUrl: () => stripSlash(trimmed("AUTH_URL") ?? "http://localhost:3000"),
  entra: () =>
    trimmed("AUTH_MICROSOFT_ENTRA_ID_ID")
      ? {
          clientId: trimmed("AUTH_MICROSOFT_ENTRA_ID_ID")!,
          clientSecret: trimmed("AUTH_MICROSOFT_ENTRA_ID_SECRET"),
          issuer: trimmed("AUTH_MICROSOFT_ENTRA_ID_ISSUER"),
        }
      : undefined,
  google: () =>
    trimmed("AUTH_GOOGLE_ID")
      ? { clientId: trimmed("AUTH_GOOGLE_ID")!, clientSecret: trimmed("AUTH_GOOGLE_SECRET") }
      : undefined,
};

/** The Strut lab on mcp. */
export const labBase = () => `${env.mcpUrl()}/lab`;
