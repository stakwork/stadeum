/**
 * Strut's packages, for the fake strut: its index check, copied from strut
 * `src/packages/indexes.ts` (`indexSubscriptionProblem`), so the fake's
 * `PUT /packages/indexes/:id` refuses exactly what the real one does, and
 * the packages an index lists, shaped as `GET /index/packages` serves
 * them (`IndexHit`, `detail` from `src/packages/detail.ts`).
 */

const Z32_KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** An index as strut files it, or the reason it is not one. */
export function indexSubscriptionProblem(sub: unknown): string | undefined {
  const s = sub as { id?: unknown; key?: unknown; urls?: unknown; label?: unknown } | undefined;
  if (!s || typeof s !== "object") return "an index is { id, key, urls, label? }";
  if (typeof s.id !== "string" || !ID.test(s.id)) return "id is [a-z0-9][a-z0-9_-]*, at most 64 characters";
  if (typeof s.key !== "string" || !Z32_KEY.test(s.key)) return "key is the index key in z-base-32 (52 characters)";
  if (!Array.isArray(s.urls) || s.urls.length === 0 || !s.urls.every((u) => typeof u === "string" && /^https?:\/\/\S+$/.test(u))) {
    return "urls is a non-empty list of http(s) URLs where the index's card is served (an index strut's /index/catalog)";
  }
  if (s.label !== undefined && typeof s.label !== "string") return "label is a string";
  return undefined;
}

/** One release an index lists, and what installing it writes (each item by its name inside the package). */
export interface FakeRelease {
  package: string;
  publisher: string;
  /** The publisher's public key. */
  key: string;
  urls: string[];
  version: string;
  digest: string;
  description?: string;
  license?: string;
  requires?: { secrets?: string[] };
  detail?: {
    apps: Array<{ name: string; title: string; description?: string; can: { spends: boolean; acts: boolean; code: boolean } }>;
    workflows: number;
    steps: number;
    concepts: number;
    secrets: string[];
    can: { spends: boolean; acts: boolean; code: boolean };
    readme: boolean;
  };
  items: Array<{ kind: "workflow" | "step" | "app" | "concept"; name: string; helper?: true }>;
}

/** An index strut can reach: where its card is served, and what it lists. */
export interface FakeIndex {
  urls: string[];
  releases: FakeRelease[];
}

/** Stakwork's index as the fake knows it. The real one has no key yet: this one is made up. */
export const STAKWORK_INDEX_KEY = "8pbk1qyeg5aoxzj3fm4xixu9nru3tcqd7w6gbk5ny1hsrzm1p9ro";
export const STAKWORK_INDEX_URL = "https://index.stakwork.ai/index/catalog";

const digest = (n: string) => `sha256:${n.repeat(64).slice(0, 64)}`;

/** openlaw1's legal desk, as it will be listed: one app, its workflows and steps, a Concept tree, three keys. */
export const LEGAL_DESK: FakeRelease = {
  package: "openlaw/legal-desk",
  publisher: "openlaw",
  key: "hs9mdejf1pyx7ybfu8bkr3aw1pyqa43c5r8xb1o9pzn6e5dddpgo",
  urls: ["https://openlaw1.example/packages/catalog?public=1"],
  version: "1.0.0",
  digest: digest("1a"),
  description: "A legal desk: matters, research on CourtListener, filings in Google Drive.",
  license: "Apache-2.0",
  requires: { secrets: ["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"] },
  detail: {
    apps: [{ name: "desk", title: "Legal desk", description: "Matters, research and filings.", can: { spends: true, acts: true, code: true } }],
    workflows: 4,
    steps: 3,
    concepts: 12,
    secrets: ["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"],
    can: { spends: true, acts: true, code: true },
    readme: true,
  },
  items: [
    { kind: "app", name: "desk" },
    { kind: "workflow", name: "research" },
    { kind: "workflow", name: "intake" },
    { kind: "workflow", name: "draft-filing" },
    { kind: "workflow", name: "file" },
    { kind: "step", name: "courtlistener-search" },
    { kind: "step", name: "serpa-search" },
    { kind: "step", name: "drive-upload" },
    { kind: "step", name: "_http", helper: true },
    ...["Legal", "Matter", "Party", "Contract", "Clause", "Filing", "Court", "Judge", "Statute", "Precedent", "Deadline", "Exhibit"].map((name) => ({ kind: "concept" as const, name })),
  ],
};

/** A package that only reads: one workflow, no secrets. */
export const DOCS_DIGEST: FakeRelease = {
  package: "stakwork/docs-digest",
  publisher: "stakwork",
  key: "zfyxfh3dgy7qtmrxyfu5a7z3cgkmybs4he4hqwrhmzaxpcx6q3yy",
  urls: ["https://stakwork.example/packages/catalog?public=1"],
  version: "0.3.1",
  digest: digest("2b"),
  description: "A weekly digest of the documents the team added.",
  license: "MIT",
  detail: { apps: [], workflows: 1, steps: 0, concepts: 0, secrets: [], can: { spends: false, acts: false, code: false }, readme: false },
  items: [{ kind: "workflow", name: "weekly" }],
};

/** The indexes the fake strut can reach, by key. */
export const fakeIndexes = (): Map<string, FakeIndex> =>
  new Map([[STAKWORK_INDEX_KEY, { urls: [STAKWORK_INDEX_URL], releases: [structuredClone(LEGAL_DESK), structuredClone(DOCS_DIGEST)] }]]);

/** Strut's search matcher: every word of `q` in the name, the description or the publisher. */
export const matches = (r: FakeRelease, q: string) => {
  const hay = `${r.package} ${r.description ?? ""} ${r.publisher}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};
