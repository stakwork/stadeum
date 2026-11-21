import type { InstalledPackage, PackageCan, PackageHit, PackageIndex, PackageInstall, PackageSubscription } from "@/lib/strut/client";

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
/**
 * How many of a kind the Installed list names; past that it says how many.
 * Concepts are a package's knowledge, often hundreds of pages: their number
 * says more than their names. Apps, workflows and steps are used by name.
 */
const NAMED_UP_TO: Record<string, number> = { concept: 5 };
const NAMED_DEFAULT = 12;

export function itemsByKind(pkg: InstalledPackage): Array<{ kind: string; label: string; items: InstalledPackage["items"]; named: boolean }> {
  const kinds = [
    ["app", "Apps"],
    ["workflow", "Workflows"],
    ["step", "Steps"],
    ["concept", "Concepts"],
  ] as const;
  return kinds
    .map(([kind, label]) => {
      const items = pkg.items.filter((i) => i.kind === kind && !i.helper);
      return { kind, label, items, named: items.length <= (NAMED_UP_TO[kind] ?? NAMED_DEFAULT) };
    })
    .filter((g) => g.items.length > 0);
}

/** An item's name inside its package: `acme/linear/sync` → `sync`. A Concept keeps its page name. */
export const shortName = (pkg: string, name: string) => (name.startsWith(`${pkg}/`) ? name.slice(pkg.length + 1) : name);

/**
 * The secrets of a package's that are the box's to set: those it requires,
 * less those its own steps manage. Strut's `secrets` is everything its steps
 * may read; `optional` among them is read only when set, and nothing asks
 * for it. A provided one (`provides.secrets`) is a person's own, which they
 * connect or paste in the package's app, or one the package's admin app
 * makes; an admin never pastes it for the whole box.
 */
export const boxSecrets = (pkg: InstalledPackage) => pkg.secrets.filter((s) => !pkg.optional?.includes(s) && !pkg.provides?.secrets.includes(s));

/**
 * The box's secrets of a package's that strut's deployment store has no
 * value for. `set` is `GET /secrets`'s names: null when strut could not
 * say, and then nothing is claimed missing.
 */
export const secretsNeeded = (pkg: InstalledPackage, set: ReadonlySet<string> | null) => (set ? boxSecrets(pkg).filter((s) => !set.has(s)) : []);

/**
 * The secret names a person may set from this page: the box's secret of an
 * installed package, or one a package the box follows waits for (strut
 * installs it once it is set), never one stadeum keeps itself.
 */
export function settableSecret(name: string, installed: readonly InstalledPackage[], followed: readonly Pick<PackageSubscription, "waiting">[] = []): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    !STADEUM_SETTINGS.has(name) &&
    (installed.some((p) => boxSecrets(p).includes(name)) || followed.some((s) => s.waiting?.secrets.includes(name)))
  );
}

/** Strut settings stadeum's own pages write (the Models page). */
const STADEUM_SETTINGS = new Set(["STRUT_DEFAULT_MODEL", "STRUT_MODELS"]);

// ── strut's refusals, said plainly ───────────────────────────────────────

/** A lead sentence for each of strut's refusal codes; strut's own words follow it. */
const LEADS: Record<string, string> = {
  package_busy: "One of its workflows is running. Try again once the run is done.",
  package_conflict: "Something on this box already uses a name the package needs.",
  package_update_not_built: "Another version of this package is installed here. Uninstall it first, then install this one.",
  package_distro_owned: "The box keeps this package up to date from what it follows, or its distro installed it: only that updates or removes it.",
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
  package_repo_denied: "The repository can’t be read: it’s private and the account it’s read with can’t reach it, or it doesn’t exist.",
  package_repo_not_found: "There’s no repository at that address.",
  package_repo_unreachable: "The repository isn’t answering. Try again later.",
  package_ref_not_found: "The repository has nothing by that name after @.",
  subscription_invalid: "Strut won’t follow that.",
  subscription_unknown: "The box doesn’t follow that any more.",
};

/** The code a refusal of strut's starts with (`package_repo_denied: …` → `package_repo_denied`). */
export const refusalCode = (detail: string | undefined): string | undefined => /^([a-z_]+):/.exec(detail ?? "")?.[1];

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

// ── an install as it goes ────────────────────────────────────────────────

/** An install's id as strut mints it (`inst_<16 hex>`). */
export const INSTALL_ID_RE = /^inst_[0-9a-f]{8,64}$/;

/** What an install wrote, as the page says it: what `POST /packages/install` answers once done. */
export interface InstallDone {
  package: string;
  version?: string;
  /** Every package of the set was here at that release already. */
  already: boolean;
  missingSecrets: string[];
  warnings: string[];
}

/** An install as the page follows it: going, done, or refused. */
export type InstallWatch = { id: string; ref: string; door: "install" | "distro" } & (
  | { status: "queued" | "running"; phase: string; package?: string; done?: number; total?: number; result?: never; error?: never }
  | { status: "done"; result: InstallDone; error?: never }
  | { status: "failed"; error: string; /** Strut's refusal code (`package_repo_denied`), when it gave one. */ code?: string; result?: never }
);

/** Strut's install record, as the page shows it: a refusal in plain words, a result as the 201 gave it. */
export function installWatch(s: PackageInstall): InstallWatch {
  const base = { id: s.id, ref: s.ref, door: s.door };
  if (s.status === "failed") {
    const code = refusalCode(s.error);
    return { ...base, status: "failed", error: explainRefusal(s.error, 500), ...(code ? { code } : {}) };
  }
  if (s.status === "done" && s.result) {
    const r = s.result;
    const mine = r.packages.find((p) => p.package === r.package);
    return {
      ...base,
      status: "done",
      result: {
        package: r.package,
        ...(mine?.version ? { version: mine.version } : {}),
        already: r.packages.every((p) => p.status === "present"),
        missingSecrets: r.missingSecrets,
        warnings: r.warnings,
      },
    };
  }
  return {
    ...base,
    status: s.status === "queued" ? "queued" : "running",
    phase: s.phase,
    ...(s.package ? { package: s.package } : {}),
    ...(s.done !== undefined ? { done: s.done } : {}),
    ...(s.total !== undefined ? { total: s.total } : {}),
  };
}

/**
 * Each phase in words, strut's own (`installProgressText`, strut
 * `web/src/package-release.ts`). `queued` says less than strut's "Waiting
 * for another install to finish": every install is queued when strut
 * first answers, behind nothing, for a moment.
 */
const PHASES: Record<string, string> = {
  queued: "Waiting to start",
  resolving: "Fetching the package",
  checking: "Checking it against this box",
  types: "Graph types",
  steps: "Steps",
  workflows: "Workflows",
  apps: "Building the apps",
  concepts: "Concepts",
  "concept-tree": "Concept tree",
  retiring: "Removing what the release dropped",
  claims: "Recording the claims",
};

/**
 * What an install is doing, in a line — "Concepts 312 / 752" — and how
 * far, 0..1, when the phase counts. A phase strut adds later shows by its
 * name.
 */
export function installProgressText(w: InstallWatch): { text: string; fraction?: number } {
  if (w.status === "done") return { text: "Installed", fraction: 1 };
  if (w.status === "failed") return { text: "Failed" };
  const label = PHASES[w.phase] ?? w.phase;
  const of = w.package && w.package !== w.ref ? ` · ${w.package}` : "";
  if (w.total !== undefined && w.total > 0 && w.done !== undefined) return { text: `${label} ${w.done} / ${w.total}${of}`, fraction: Math.min(1, w.done / w.total) };
  return { text: `${w.phase === "types" && w.total ? `${label} (${w.total})` : label}${of}` };
}

// ── from a repository ────────────────────────────────────────────────────

/** A repository's ref, checked as strut checks it (`parseGitRef`, `parseRepo`), and what the page keeps of it. */
export interface RepositoryRef {
  /** What strut is sent: `git+<address>[@<rev>][#<folder>]`. */
  ref: string;
  /** The repository's address, as given, with no trailing slash. */
  address: string;
  /** A branch (or, for one install, a tag or a commit); none: the default branch. */
  rev?: string;
  /** The folder that holds the package; none: the root. */
  folder?: string;
  /** Where the package is, whatever the branch: the same for every ref to it. */
  source: string;
  /** `rev` is a full commit, which never moves. */
  commit: boolean;
}

// Strut's own grammar (`src/steps/lib/git/_shared.ts`, `src/packages/git-source.ts`).
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REV_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const FOLDER_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * A package's repository as an admin gives it: `git+https://host/owner/repo
 * [@<branch>][#<folder>]`, or the same address without `git+`. Checked as
 * strut will check it, so what is wrong is said here, plainly, before
 * anything is sent: an address that is not a repository's over http(s),
 * one with a password in it, a branch or a folder that cannot be one.
 */
export function parseRepositoryRef(raw: string): RepositoryRef | { error: string } {
  const given = typeof raw === "string" ? raw.trim() : "";
  if (!given) return { error: "Give the repository’s address." };
  if (/^(ssh:\/\/|git@|git:\/\/)/i.test(given) || /^[\w.-]+@[\w.-]+:/.test(given)) {
    return { error: "That’s an SSH address. Give the repository’s https address: the box reads it over https, with your own account for a private one." };
  }
  const body = given.replace(/^git\+/i, "");
  const hash = body.indexOf("#");
  const beforeHash = hash < 0 ? body : body.slice(0, hash);
  const rawFolder = hash < 0 ? undefined : body.slice(hash + 1);
  const schemeEnd = beforeHash.indexOf("://");
  const at = beforeHash.lastIndexOf("@");
  const hasRev = schemeEnd >= 0 && at > schemeEnd + 2 && !beforeHash.slice(schemeEnd + 3, at).includes("@") && beforeHash.slice(schemeEnd + 3, at).includes("/");
  const address = (hasRev ? beforeHash.slice(0, at) : beforeHash).replace(/\/+$/, "");
  const rev = hasRev ? beforeHash.slice(at + 1) : undefined;

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { error: "That isn’t a repository’s address. It looks like https://host/owner/name." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "A repository’s address here starts with https://." };
  if (url.username || url.password) return { error: "Leave the name and password out of the address: a private repository is read with your own account." };
  if (url.search) return { error: "A repository’s address has no ?… in it." };
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return { error: "That address names no repository: it needs an owner and a name, like https://host/owner/name." };
  const bad = segs.find((s) => !SEGMENT_RE.test(s));
  if (bad) return { error: `“${bad}” can’t be part of a repository’s address.` };
  if (rev !== undefined && (!rev || !REV_RE.test(rev) || rev.includes("..") || rev.includes("//") || rev.endsWith("/") || rev.endsWith(".lock"))) {
    return { error: rev ? `“${rev}” isn’t a branch’s name.` : "Nothing follows @: name a branch, or leave @ out for the default branch." };
  }
  let folder: string | undefined;
  if (rawFolder !== undefined) {
    const parts = rawFolder.split("/").filter(Boolean);
    if (!parts.length) return { error: "Nothing follows #: name the folder that holds the package, or leave # out for the repository’s root." };
    if (parts.some((s) => !FOLDER_SEGMENT_RE.test(s) || s === "..")) return { error: `“${rawFolder}” isn’t a folder in the repository.` };
    folder = parts.join("/");
  }
  const clean = `${url.protocol}//${url.host}/${segs.join("/")}`;
  return {
    ref: `git+${clean}${rev ? `@${rev}` : ""}${folder ? `#${folder}` : ""}`,
    address: clean,
    ...(rev ? { rev } : {}),
    ...(folder ? { folder } : {}),
    source: `${url.host}/${segs.join("/")}`.toLowerCase().replace(/\.git$/, "") + (folder ? `#${folder}` : ""),
    commit: !!rev && FULL_SHA_RE.test(rev),
  };
}

/** FNV-1a, 32 bits, as 8 hex: a short name for a place, the same everywhere. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * The id strut files a followed repository under: its name and a hash of
 * where the package is (`source`), so following it again, on another
 * branch or as another admin, is the same subscription. Strut's grammar:
 * a letter or digit first, at most 64.
 */
export function subscriptionIdOf(r: Pick<RepositoryRef, "source">): string {
  const name = r.source.replace(/#.*$/, "").split("/").pop()!.replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 48);
  return `${name || "repo"}-${fnv1a(r.source)}`;
}

/** Something the box follows, as the page shows it: strut's record, and the person it is (none: nobody's); a bundle's parts the same. */
export type Followed = Omit<PackageSubscription, "parts"> & { whose?: string; mine: boolean; parts?: Followed[] };

/** Where it comes from: a branch's ref, or a catalog's address and channel. */
export const followedFrom = (f: Pick<PackageSubscription, "id" | "ref" | "url" | "channel">) =>
  f.ref ?? (f.url ? `${hostOf(f.url)}${f.channel ? `, channel ${f.channel}` : ""}` : f.id);

/**
 * How it stands, as a dot and a word: its last read failed (a bundle's
 * own, or one of its parts'), a package of it waits for keys, another
 * subscription holds one of its packages, it hasn't been read, or it's
 * at the newest release.
 */
export function followedState(f: Pick<PackageSubscription, "checkedAt" | "error" | "waiting" | "held"> & { parts?: ReadonlyArray<Pick<PackageSubscription, "error">> }): {
  tone: "ok" | "attention" | "pending";
  label: string;
} {
  if (f.error) return { tone: "attention", label: "Last check failed" };
  if (f.parts?.some((p) => p.error)) return { tone: "attention", label: "A part’s last check failed" };
  if (f.waiting) return { tone: "attention", label: "Waiting for keys" };
  if (f.held) return { tone: "attention", label: "Held by another" };
  if (!f.checkedAt) return { tone: "pending", label: "Not read yet" };
  return { tone: "ok", label: "Up to date" };
}

/** A provider the connect seam has (`lib/connect.ts`): its id and name, and the secrets it writes. */
export interface ConnectOffer {
  id: string;
  name: string;
  secrets: string[];
}

/**
 * When strut could not read a repository, the account to connect: the
 * seam's provider for the secret strut reads it with (a subscription's
 * `tokenSecret`, the one that serves the repository's host), or one strut's
 * words name ("set the secret GITHUB_TOKEN …"). Nothing for any other
 * refusal, nor for a host no secret serves: no account would be read.
 */
export function connectFor(code: string | undefined, words: string, providers: readonly ConnectOffer[], tokenSecret?: string): ConnectOffer | undefined {
  if (code !== "package_repo_denied") return undefined;
  const named = (s: string) => s === tokenSecret || new RegExp(`\\b${s}\\b`).test(words);
  return providers.find((p) => p.secrets.some(named));
}

/** The seam's link for a person to connect their own account, back to this page. */
export const connectHref = (p: Pick<ConnectOffer, "id">) => `/api/connect/${encodeURIComponent(p.id)}?${new URLSearchParams({ return: "/packages" })}`;

/** A subscription's id, as strut takes it (`peerIdProblem`). */
export const SUBSCRIPTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Strut's subscriptions as the page shows them: each with whose it is, by name, and whether it is this admin's; a bundle's parts the same. */
export const followedOf = (subs: readonly PackageSubscription[], names: ReadonlyMap<string, string>, me: string): Followed[] =>
  subs.map(({ parts, ...s }) => ({
    ...s,
    ...(s.actor ? { whose: names.get(s.actor) ?? s.actor } : {}),
    mine: !!s.actor && s.actor === me,
    ...(parts ? { parts: followedOf(parts, names, me) } : {}),
  }));

/** Everyone whose something the box follows is, a bundle's parts' included: the names `followedOf` needs. */
export const followedActors = (subs: readonly PackageSubscription[]): Array<string | undefined> => subs.flatMap((s) => [s.actor, ...followedActors(s.parts ?? [])]);

/**
 * What a `subscription:<id>` source names (strut files a subscription's
 * installs, and the packages they wrote, under it): the subscription, and
 * when it is a bundle's part (`subscription:<id>/<part>`), that part's id.
 * A subscription's own id has no `/`.
 */
export function followedSourceOf(ref: string | undefined): { id: string; part?: string } | undefined {
  if (!ref?.startsWith("subscription:")) return undefined;
  const full = ref.slice("subscription:".length);
  const id = full.split("/")[0]!;
  return full === id ? { id } : { id, part: full };
}

/** The subscription an install or an installed package's source belongs to, if one does: a bundle's, for one of its parts. */
export const followedIdOf = (ref: string | undefined): string | undefined => followedSourceOf(ref)?.id;

/** What the box follows that a `subscription:<id>` source names: the subscription, and its part when a bundle's part holds it. */
export function followedBySource<T extends { id: string; parts?: T[] }>(subs: readonly T[], ref: string | undefined): { sub: T; part?: T } | undefined {
  const at = followedSourceOf(ref);
  const sub = at && subs.find((s) => s.id === at.id);
  if (!sub) return undefined;
  const part = at.part ? sub.parts?.find((p) => p.id === at.part) : undefined;
  return part ? { sub, part } : { sub };
}

/**
 * What the box follows from the same place as `ref`, on any branch: a
 * subscription to it, or a bundle's part (`part`, with the bundle as
 * `sub`). Nothing for a ref that isn't a repository's.
 */
export function followingFrom<T extends { ref?: string; parts?: T[] }>(subs: readonly T[], ref: string): { sub: T; part?: T } | undefined {
  const source = sourceOf(ref);
  if (!source) return undefined;
  // A subscription of its own first: a bundle's part from the same place is held by it.
  const own = subs.find((s) => sourceOf(s.ref) === source);
  if (own) return { sub: own };
  for (const sub of subs) {
    const part = sub.parts?.find((p) => sourceOf(p.ref) === source);
    if (part) return { sub, part };
  }
  return undefined;
}

/** Where a ref's package is, the same for every branch (`RepositoryRef.source`). */
function sourceOf(ref: string | undefined): string | undefined {
  const r = ref ? parseRepositoryRef(ref) : undefined;
  return r && !("error" in r) ? r.source : undefined;
}

// ── the Software card ───────────────────────────────────────────────────

/**
 * The bundle the Software card follows (`plans/software.md` §4): one
 * subscription to its repository, through From a repository's path. What
 * it brings is its `strut.yaml`'s to say, never stadeum's.
 */
export const SOFTWARE_REF = "git+https://github.com/stakwork/strut-software@stable";

/** What the Software card says the bundle does. */
export const SOFTWARE_WORDS = "Your repositories, known to the box and in its graph, and a machine of its own for every coding job.";

/** Software as the box follows it: the subscription to its repository (on any branch, anyone's), or none. */
export function softwareOf<T extends { ref?: string; parts?: T[] }>(followed: readonly T[]): T | undefined {
  const f = followingFrom(followed, SOFTWARE_REF);
  return f && !f.part ? f.sub : undefined;
}
