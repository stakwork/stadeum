import type { InstalledPackage, PackageCan, PackageHit, PackageIndex } from "@/lib/strut/client";

/**
 * The Packages page's reading of strut's packages (strut `specs/API.md`
 * §16): the store's install link, the indexes the box follows, what a
 * package brings and can do, the secrets it still needs, and strut's
 * refusals in plain words. Strut keeps all of it; nothing here is a copy.
 */

/** A package's name: `publisher/name` (strut `store-links.ts`, `PACKAGE_NAME_RE`). */
export const PACKAGE_NAME_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
/** An index key or a publisher's: z-base-32, Pkarr's form, 52 characters. */
export const Z32_KEY_RE = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;
/** The id strut files an index under (`PUT /packages/indexes/:id`). */
export const INDEX_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const HTTP_URL_RE = /^https?:\/\/\S+$/;

/** What the store hands this page: the package, and the index that lists it, so the box can follow that index first. */
export interface InstallLink {
  pkg: string;
  index?: { key: string; url: string };
}

type Query = URLSearchParams | Record<string, string | string[] | undefined>;
const param = (q: Query, k: string) => {
  const v = q instanceof URLSearchParams ? q.get(k) : q[k];
  return typeof v === "string" ? v : null;
};

/**
 * `?install=<publisher/name>[&index=<key>&index_url=<url>]`, as the store's
 * Install link builds it, checked as strut's own shell checks it
 * (`parseInstallLink`): null without a well-formed name; the index only
 * with both a z-base-32 key and an http(s) address.
 */
export function parseInstallLink(q: Query): InstallLink | null {
  const pkg = param(q, "install");
  if (!pkg || !PACKAGE_NAME_RE.test(pkg)) return null;
  const key = param(q, "index");
  const url = param(q, "index_url");
  return key && Z32_KEY_RE.test(key) && url && HTTP_URL_RE.test(url) ? { pkg, index: { key, url } } : { pkg };
}

/** The id an index is filed under when followed from its address: its host (strut `indexIdOf`). */
export function indexIdOf(url: string): string {
  let host = "index";
  try {
    host = new URL(url).host || host;
  } catch {
    // Keep the default.
  }
  return (
    host
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "index"
  );
}

/** An address's host, for a person to read. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** A key, short: its first 8 and last 6 characters. */
export const shortKey = (key: string) => (key.length > 20 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key);

/**
 * Where the link's index stands on this box: followed (by its key, under
 * whatever id), new, or in the way: another key filed under the id it
 * would take, which a link must never replace.
 */
export type LinkIndexState =
  | { state: "followed"; id: string }
  | { state: "new"; id: string }
  | { state: "clash"; id: string; key: string };

export function linkIndexState(link: { key: string; url: string }, indexes: readonly PackageIndex[]): LinkIndexState {
  const same = indexes.find((i) => i.key === link.key);
  if (same) return { state: "followed", id: same.id };
  const id = indexIdOf(link.url);
  const taken = indexes.find((i) => i.id === id);
  return taken ? { state: "clash", id, key: taken.key } : { state: "new", id };
}

// ── what a package brings, and can do ────────────────────────────────────

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 apps, 5 workflows, 3 steps, 12 Concepts": what the index read off the release. */
export function bringsWords(detail: NonNullable<PackageHit["detail"]>): string[] {
  const out: string[] = [];
  if (detail.apps.length) out.push(count(detail.apps.length, "app"));
  if (detail.workflows) out.push(count(detail.workflows, "workflow"));
  if (detail.steps) out.push(count(detail.steps, "step"));
  if (detail.concepts) out.push(count(detail.concepts, "Concept"));
  return out;
}

/** What running it reaches, each in a few words; "Only reads" when it does none of them. */
export function canWords(can: PackageCan): string[] {
  const out: string[] = [];
  if (can.spends) out.push("Spends model calls");
  if (can.acts) out.push("Acts on the world");
  if (can.code) out.push("Runs code");
  return out.length ? out : ["Only reads"];
}

/** The secrets a hit names: the index's reading, else its catalog's `requires`. */
export const hitSecrets = (hit: PackageHit) => (hit.detail ? hit.detail.secrets : hit.secrets);

/** An installed package's items a person recognises: helpers left out, by kind. */
export function itemsByKind(pkg: InstalledPackage): Array<{ kind: string; label: string; items: InstalledPackage["items"] }> {
  const kinds = [
    ["app", "Apps"],
    ["workflow", "Workflows"],
    ["step", "Steps"],
    ["concept", "Concepts"],
  ] as const;
  return kinds
    .map(([kind, label]) => ({ kind, label, items: pkg.items.filter((i) => i.kind === kind && !i.helper) }))
    .filter((g) => g.items.length > 0);
}

/** An item's name inside its package: `acme/linear/sync` → `sync`. A Concept keeps its page name. */
export const shortName = (pkg: string, name: string) => (name.startsWith(`${pkg}/`) ? name.slice(pkg.length + 1) : name);

/**
 * The secrets a package's steps read that the box's store has no value
 * for. `set` is `GET /secrets`'s names: null when strut could not say, and
 * then nothing is claimed missing.
 */
export const secretsNeeded = (pkg: InstalledPackage, set: ReadonlySet<string> | null) => (set ? pkg.secrets.filter((s) => !set.has(s)) : []);

/** The secret names a person may set from this page: those an installed package declares, never one stadeum keeps itself. */
export function settableSecret(name: string, installed: readonly InstalledPackage[]): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !STADEUM_SETTINGS.has(name) && installed.some((p) => p.secrets.includes(name));
}

/** Strut settings stadeum's own pages write (the Models page). */
const STADEUM_SETTINGS = new Set(["STRUT_DEFAULT_MODEL", "STRUT_MODELS"]);

// ── strut's refusals, said plainly ───────────────────────────────────────

/** A lead sentence for each of strut's refusal codes; strut's own words follow it. */
const LEADS: Record<string, string> = {
  package_busy: "One of its workflows is running. Try again once the run is done.",
  package_conflict: "Something on this box already uses a name the package needs.",
  package_update_not_built: "Another version of this package is installed here. Uninstall it first, then install this one.",
  package_distro_owned: "The box’s distro installed this package: only the distro updates or removes it.",
  package_not_installed: "That package isn’t installed.",
  package_not_listed: "No index this box follows lists that publisher.",
  package_not_found: "The publisher’s catalog doesn’t have that package.",
  package_not_published: "The publisher’s catalog doesn’t list that release.",
  package_index_unknown: "This box doesn’t follow that index any more.",
  package_source_invalid: "Strut can’t look that package up.",
  package_index_unreachable: "The index isn’t answering. Try again later.",
  package_index_invalid: "That isn’t an index strut can follow.",
  package_fetch_failed: "The publisher’s catalog isn’t answering. Try again later.",
  package_digest_mismatch: "What the publisher served doesn’t match the release. Nothing was installed.",
  bad_package: "The package doesn’t install on this box.",
};

/**
 * A refusal of strut's, as a person reads it: a plain sentence for the
 * code it starts with, then strut's own words. A `catalog_*` code is a
 * catalog that failed its checks (the seal, the key, the order).
 */
export function explainRefusal(detail: string | undefined, status: number): string {
  if (!detail) return status === 0 ? "Strut isn’t answering. Nothing changed." : `Strut answered ${status}. Nothing changed.`;
  const m = /^([a-z_]+):\s*(.*)$/s.exec(detail);
  const code = m?.[1] ?? "";
  const words = (m ? m[2]! : detail).trim();
  const lead = LEADS[code] ?? (code.startsWith("catalog_") ? "The publisher’s catalog didn’t pass its checks, so nothing was installed." : undefined);
  if (!lead) return detail;
  return words ? `${lead} Strut says: ${words}` : lead;
}
