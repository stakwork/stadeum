/**
 * An app's versions, as a person reads them: copied from strut
 * `web/src/app-versions.ts` (at 5c3fb86, plans/app-releases.md) so the
 * admin Apps page says exactly what strut's own Versions flyout says. Its
 * tests are ported in app-versions.test.ts. Dates use `@/lib/format`
 * instead of strut's `when`; `liveLabel` and `pinNote` are stadeum's.
 *
 * One row per page version, newest first, with the one state a person
 * needs: live, was live (a release named it once, a version rolled back
 * from too), or a draft (published while the app is held, after the live
 * version, and never made live). Release ids (`r9`) are the server's
 * bookkeeping and never a row of their own: a version that was live is
 * restored through its newest release. No workflow versions or locks: what
 * a lock holds is a record, not something to read (stakwork/strut#510).
 */

/** What `GET /apps/:name/versions` says, as far as these need it. */
export interface AppVersionsData {
  /** The live version. */
  active: string;
  versions: Record<string, { createdAt: string; source?: string }>;
  /** The live release's id, or `latest` while following. */
  live: string;
  /** Oldest first. */
  releases: Array<{ id: string; version: string; createdAt: string; by?: string }>;
}

export type AppVersionState = "live" | "draft" | "was-live" | "";

export interface AppVersionRow {
  version: string;
  createdAt: string;
  state: AppVersionState;
  /** The newest release of this version, which Restore makes live again. */
  release?: string;
}

/** `v12` → 12. */
export const versionNumber = (v: string): number => Number(v.replace(/^v/, "")) || 0;

/** Held at a release (a publish is a draft), or following latest. */
export const isHeld = (live: string | undefined): boolean => !!live && live !== "latest";

/** A version published after the live one while the app is held. */
export const isDraft = (version: string, active: string, live: string | undefined): boolean =>
  isHeld(live) && versionNumber(version) > versionNumber(active);

/** Strut seeds the app and makes its committed version live at every boot: it cannot be held. */
export const isSeeded = (data: AppVersionsData): boolean => data.versions[data.active]?.source === "seed";

/** The newest version published. */
export const newestVersion = (versions: string[]): string | undefined =>
  [...versions].sort((a, b) => versionNumber(b) - versionNumber(a))[0];

/** Every version, newest first, each in its state. */
export function appVersionRows(data: AppVersionsData): AppVersionRow[] {
  const newestRelease = new Map<string, string>();
  for (const r of data.releases) newestRelease.set(r.version, r.id);
  return Object.entries(data.versions)
    .sort(([a], [b]) => versionNumber(b) - versionNumber(a))
    .map(([version, info]) => {
      const release = newestRelease.get(version);
      const state: AppVersionState =
        version === data.active ? "live" : release ? "was-live" : isDraft(version, data.active, data.live) ? "draft" : "";
      return { version, createdAt: info.createdAt, state, ...(release ? { release } : {}) };
    });
}

/** The drafts the rows show. */
export const draftsOf = (data: AppVersionsData): number => appVersionRows(data).filter((r) => r.state === "draft").length;

/** The release that is live while the app is held. */
export const liveRelease = (data: AppVersionsData) =>
  isHeld(data.live) ? data.releases.find((r) => r.id === data.live) : undefined;

export const STATE_LABEL: Record<AppVersionState, string> = {
  live: "live",
  draft: "draft",
  "was-live": "was live",
  "": "",
};

/** What making `version` live does, in the words the confirm button shows. */
export function makeLiveNote(version: string, live: string | undefined): string {
  return isHeld(live)
    ? `Everyone who opens the app gets ${version} now.`
    : `Everyone who opens the app gets ${version} now, and it stays there: later publishes wait as drafts until you make one live.`;
}

/** What Restore does: the version again, as its release recorded it. */
export const restoreNote = (version: string): string => `Everyone who opens the app gets ${version} again.`;

/** What switching to "every publish goes live" does. */
export function followNote(data: AppVersionsData): string {
  const newest = newestVersion(Object.keys(data.versions));
  return newest && newest !== data.active
    ? `Everyone gets ${newest}, the newest publish, now — and every later publish goes live as soon as it is published.`
    : "Every later publish goes live as soon as it is published.";
}

/** What switching to "hold a version" does. */
export const holdNote = (active: string): string =>
  `The app stays at ${active}. Later publishes wait as drafts until you make one live.`;

// ── stadeum's ───────────────────────────────────────────────────────────

/** What is live, in a word: following latest, or held. */
export const liveLabel = (active: string, live: string | undefined): string =>
  isHeld(live) ? `Holding ${active}` : "Every publish goes live";

/**
 * What pinning does here: stadeum lists pinned apps right after Jamie
 * (strut's "tab"), and pinning an app that follows latest also holds it
 * at its live version (`PUT /apps/:name/pin`, strut's Tab toggle wording).
 */
export function pinNote(pinned: boolean, active: string, live: string | undefined): string {
  if (pinned) return "Everyone sees the app among the others again, by title. What is live stays as it is.";
  return isHeld(live)
    ? "Everyone sees the app pinned near the top of their apps."
    : `Everyone sees the app pinned near the top of their apps, and it stays at ${active}: later publishes wait as drafts until you make one live.`;
}
