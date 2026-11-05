/** Strut's `web/src/app-versions.test.ts` (at 5c3fb86), ported, plus stadeum's own notes. */
import { describe, expect, it } from "vitest";

import {
  appVersionRows,
  draftsOf,
  followNote,
  holdNote,
  isSeeded,
  liveLabel,
  liveRelease,
  makeLiveNote,
  pinNote,
  restoreNote,
  type AppVersionsData,
} from "./app-versions";

const at = (day: number) => `2026-11-0${day}T12:00:00.000Z`;

/** Held at v8 (r9), drafts v9–v11, v2 made live twice. */
const held: AppVersionsData = {
  active: "v8",
  live: "r9",
  versions: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`v${i + 1}`, { createdAt: at(1) }])),
  releases: [
    { id: "r1", version: "v1", createdAt: at(1) },
    { id: "r2", version: "v2", createdAt: at(1) },
    { id: "r3", version: "v2", createdAt: at(2), by: "evan-x1" },
    ...[3, 4, 5, 6, 7, 8].map((n, i) => ({ id: `r${i + 4}`, version: `v${n}`, createdAt: at(3) })),
  ],
};

describe("appVersionRows", () => {
  it("is one row per version, newest first, each in its state", () => {
    const rows = appVersionRows(held);
    expect(rows.map((r) => r.version)).toEqual(["v11", "v10", "v9", "v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1"]);
    expect(rows.map((r) => r.state)).toEqual(["draft", "draft", "draft", "live", "was-live", "was-live", "was-live", "was-live", "was-live", "was-live", "was-live"]);
    // A version made live twice restores through its newest release.
    expect(rows.find((r) => r.version === "v2")?.release).toBe("r3");
    expect(rows.find((r) => r.version === "v11")?.release).toBeUndefined();
  });

  it("marks a version rolled back from as was live, never a draft", () => {
    // v6 made live (r10), then v4 restored (r6): v6 is newer than live but was seen.
    const rolledBack: AppVersionsData = { ...held, active: "v4", live: "r6", releases: [...held.releases, { id: "r10", version: "v6", createdAt: at(4) }] };
    const rows = appVersionRows(rolledBack);
    const state = (v: string) => rows.find((r) => r.version === v)?.state;
    expect(state("v6")).toBe("was-live");
    expect(rows.find((r) => r.version === "v6")?.release).toBe("r10");
    expect(state("v5")).toBe("was-live");
    expect(state("v4")).toBe("live");
    expect(state("v11")).toBe("draft");
    // v5–v8 were live once: only v9–v11 wait as drafts.
    expect(draftsOf(rolledBack)).toBe(3);
  });

  it("has no drafts while following latest", () => {
    const following: AppVersionsData = { ...held, active: "v11", live: "latest" };
    const rows = appVersionRows(following);
    expect(rows[0]?.state).toBe("live");
    expect(rows.some((r) => r.state === "draft")).toBe(false);
    expect(rows.find((r) => r.version === "v8")?.state).toBe("was-live");
    expect(rows.find((r) => r.version === "v9")?.state).toBe("");
    expect(draftsOf(following)).toBe(0);
  });

  it("sorts versions by number, not as text", () => {
    const rows = appVersionRows({ active: "v2", live: "latest", releases: [], versions: { v2: { createdAt: at(1) }, v10: { createdAt: at(2) }, v9: { createdAt: at(1) } } });
    expect(rows.map((r) => r.version)).toEqual(["v10", "v9", "v2"]);
  });
});

describe("the live release and seeding", () => {
  it("knows the held release, and none while following", () => {
    expect(liveRelease(held)?.version).toBe("v8");
    expect(liveRelease({ ...held, live: "latest" })).toBeUndefined();
    expect(draftsOf(held)).toBe(3);
  });

  it("reads seeding off the live version's source", () => {
    expect(isSeeded(held)).toBe(false);
    expect(isSeeded({ ...held, versions: { ...held.versions, v8: { createdAt: at(1), source: "seed" } } })).toBe(true);
  });
});

describe("the confirm notes say what everyone gets", () => {
  it("matches strut's wording", () => {
    expect(makeLiveNote("v11", "r9")).toBe("Everyone who opens the app gets v11 now.");
    expect(makeLiveNote("v7", "latest")).toMatch(/stays there: later publishes wait as drafts/);
    expect(restoreNote("v2")).toBe("Everyone who opens the app gets v2 again.");
    expect(followNote(held)).toMatch(/^Everyone gets v11, the newest publish, now/);
    expect(followNote({ ...held, active: "v11" })).toBe("Every later publish goes live as soon as it is published.");
    expect(holdNote("v8")).toBe("The app stays at v8. Later publishes wait as drafts until you make one live.");
  });

  it("says what is live, and what pinning holds", () => {
    expect(liveLabel("v8", "r9")).toBe("Holding v8");
    expect(liveLabel("v11", "latest")).toBe("Every publish goes live");
    expect(pinNote(false, "v3", "latest")).toMatch(/and it stays at v3: later publishes wait as drafts/);
    expect(pinNote(false, "v3", "r2")).not.toMatch(/stays at/);
    expect(pinNote(true, "v3", "r2")).toMatch(/What is live stays as it is/);
  });
});
