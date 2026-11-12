import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { governanceClient, pluginClient } from "@/lib/mothership/admin-credentials";
import { BifrostHttpError } from "@/lib/mothership/http";
import { macaroonOrgId } from "@/lib/mothership/keys";
import { health, StrutHttpError } from "@/lib/strut/client";

/**
 * The status page's checks. Each one stores its last result and time, so
 * the page shows when something was last known good.
 */

export const CHECKS = [
  { name: "strut", label: "Workflow engine" },
  { name: "neo4j", label: "Knowledge graph" },
  { name: "bifrost", label: "Model gateway" },
  { name: "trust", label: "Organisation key" },
  { name: "ops", label: "Upkeep" },
] as const;

/** Apps can run when these pass; the graph only limits what they can find. */
export const NEEDED_TO_RUN: CheckName[] = ["strut", "bifrost", "trust"];

export type CheckName = (typeof CHECKS)[number]["name"];

/**
 * The containers (stack/stadeum.yml), each with the check that stands for
 * its health. stadeum-ui has no Docker socket, so a service it never talks
 * to (caddy, redis, strut-browser, voice, treasury) has no check here; ops
 * talks to it.
 */
export const SERVICES: Array<{ service: string; label: string; check?: CheckName | "self" }> = [
  { service: "stadeum-ui", label: "Web app", check: "self" },
  { service: "caddy", label: "Router" },
  { service: "neo4j", label: "Knowledge graph", check: "neo4j" },
  { service: "redis", label: "Cache" },
  { service: "bifrost", label: "Model gateway", check: "bifrost" },
  { service: "strut", label: "Workflow engine", check: "strut" },
  { service: "strut-browser", label: "Browser" },
  { service: "voice", label: "Calls" },
  { service: "treasury", label: "Wallet" },
  { service: "bootstrap", label: "Organisation key", check: "trust" },
  { service: "ops", label: "Upkeep", check: "ops" },
];

const TIMEOUT = 5_000;

/** A failure in two or three words: "Unreachable", "Timed out", "Answered 503". */
function terse(err: unknown): string {
  if (err instanceof BifrostHttpError) {
    if (err.status === 0) return /timed out/.test(err.message) ? "Timed out" : "Unreachable";
    return `Answered ${err.status}`;
  }
  if (err instanceof StrutHttpError) return `Answered ${err.status}`;
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "Timed out";
  return "Unreachable";
}

async function probe(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT) });
}

async function checkBifrostAndTrust(): Promise<Record<"bifrost" | "trust", { ok: boolean; detail: string }>> {
  try {
    const status = await pluginClient().getTrustStatus();
    const orgId = macaroonOrgId();
    const org = await db.org.findUnique({ where: { id: "org" } });
    let trust: { ok: boolean; detail: string };
    if (!org?.orgPubkey) {
      trust = { ok: false, detail: "No signing key yet" };
    } else if (!status.orgs.includes(orgId)) {
      trust = { ok: false, detail: `Not registered · ${orgId}` };
    } else {
      const row = await pluginClient().getTrustOrg(orgId);
      trust =
        row && row.pubkey.toLowerCase() === org.orgPubkey.toLowerCase()
          ? { ok: true, detail: `Registered · ${orgId}` }
          : { ok: false, detail: `Registered with a different key · ${orgId}` };
    }
    // Best-effort: the configured providers need the admin credentials.
    const providers = await governanceClient()
      .then((c) => c.listProviders())
      .then((r) => (r.providers ?? []).map((p) => p.name))
      .catch(() => null);
    return {
      bifrost: {
        ok: true,
        detail: providers?.length ? `Reachable · ${providers.join(", ")}` : "Reachable",
      },
      trust,
    };
  } catch (err) {
    return {
      bifrost: { ok: false, detail: terse(err) },
      trust: { ok: false, detail: "Gateway unreachable" },
    };
  }
}

/** `GET /health` with the key. Strut answers a key it does not hold with `{ ok }` alone. */
async function checkStrut(): Promise<{ ok: boolean; detail: string }> {
  try {
    const started = Date.now();
    const h = await health(TIMEOUT);
    const ms = Date.now() - started;
    if (!h.workspace) return { ok: false, detail: "Key not accepted" };
    if (h.drain) return { ok: false, detail: `Draining · ${h.drain.reason ?? "maintenance"}` };
    return { ok: true, detail: `Reachable · ${ms} ms` };
  } catch (err) {
    return { ok: false, detail: terse(err) };
  }
}

async function checkNeo4j(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await probe(`${env.neo4jHttpUrl()}/`, { headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, detail: `Answered ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { neo4j_version?: string };
    return { ok: true, detail: body.neo4j_version ? `Reachable · ${body.neo4j_version}` : "Reachable" };
  } catch (err) {
    return { ok: false, detail: terse(err) };
  }
}

/** ops reports every half minute while idle (it has no port to probe). */
async function checkOps(): Promise<{ ok: boolean; detail: string }> {
  const row = await db.opsStatus.findUnique({ where: { id: "ops" } });
  if (!row) return { ok: false, detail: "Not reported yet" };
  const phase = (JSON.parse(row.state) as { phase?: string }).phase ?? "idle";
  if (phase !== "idle") return { ok: true, detail: `Busy · ${phase.replace("-", " ")}` };
  if (Date.now() - row.reportedAt.getTime() > 3 * 60_000) return { ok: false, detail: `Last reported ${relativeTime(row.reportedAt)}` };
  return { ok: true, detail: "Reporting" };
}

/** Run every check and store the results. */
export async function runChecks(): Promise<void> {
  const [bt, strut, neo4j, ops] = await Promise.all([checkBifrostAndTrust(), checkStrut(), checkNeo4j(), checkOps()]);
  const checkedAt = new Date();
  const results: Record<CheckName, { ok: boolean; detail: string }> = { ...bt, strut, neo4j, ops };
  await db.$transaction(
    Object.entries(results).map(([name, r]) =>
      db.healthCheck.upsert({
        where: { name },
        create: { name, ok: r.ok, detail: r.detail, checkedAt },
        update: { ok: r.ok, detail: r.detail, checkedAt },
      }),
    ),
  );
}

export async function lastResults() {
  const rows = await db.healthCheck.findMany();
  return new Map(rows.map((r) => [r.name, r]));
}
