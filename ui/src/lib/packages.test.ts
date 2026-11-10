import { describe, expect, it } from "vitest";

import { STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL } from "@/test/strut-packages";
import { bringsWords, canWords, explainRefusal, indexIdOf, itemsByKind, linkIndexState, parseInstallLink, secretsNeeded, settableSecret } from "./packages";
import type { InstalledPackage } from "./strut/client";

const KEY = STAKWORK_INDEX_KEY;

describe("parseInstallLink", () => {
  it("reads the store's link as strut's shell does: the name, and the index only with a key and an http(s) address", () => {
    const q = new URLSearchParams({ install: "openlaw/legal-desk", index: KEY, index_url: STAKWORK_INDEX_URL });
    expect(parseInstallLink(q)).toEqual({ pkg: "openlaw/legal-desk", index: { key: KEY, url: STAKWORK_INDEX_URL } });
    // Next hands the page its query as a record.
    expect(parseInstallLink({ install: "openlaw/legal-desk", index: KEY, index_url: STAKWORK_INDEX_URL })).toEqual({
      pkg: "openlaw/legal-desk",
      index: { key: KEY, url: STAKWORK_INDEX_URL },
    });
    expect(parseInstallLink({ install: "openlaw/legal-desk" })).toEqual({ pkg: "openlaw/legal-desk" });
  });

  it("drops a malformed index and refuses a malformed name", () => {
    expect(parseInstallLink({ install: "openlaw/legal-desk", index: KEY.slice(1), index_url: STAKWORK_INDEX_URL })).toEqual({ pkg: "openlaw/legal-desk" });
    expect(parseInstallLink({ install: "openlaw/legal-desk", index: KEY.replace(/^./, "0"), index_url: STAKWORK_INDEX_URL })).toEqual({ pkg: "openlaw/legal-desk" });
    expect(parseInstallLink({ install: "openlaw/legal-desk", index: KEY, index_url: "javascript:alert(1)" })).toEqual({ pkg: "openlaw/legal-desk" });
    expect(parseInstallLink({ install: "openlaw/legal-desk", index: KEY })).toEqual({ pkg: "openlaw/legal-desk" });
    for (const install of ["Openlaw/legal-desk", "openlaw", "openlaw/legal-desk/x", "../etc", "pk:abc/openlaw/legal-desk", ""]) {
      expect(parseInstallLink({ install, index: KEY, index_url: STAKWORK_INDEX_URL })).toBeNull();
    }
    expect(parseInstallLink({ install: ["openlaw/legal-desk", "x/y"] })).toBeNull();
    expect(parseInstallLink({})).toBeNull();
  });
});

describe("indexIdOf and linkIndexState", () => {
  it("files an index under its host, as strut's UI does", () => {
    expect(indexIdOf(STAKWORK_INDEX_URL)).toBe("index-stakwork-ai");
    expect(indexIdOf("http://localhost:3000/index/catalog")).toBe("localhost-3000");
    expect(indexIdOf("not a url")).toBe("index");
  });

  it("tells a followed index (by its key, under any id), a new one, and one whose address another key holds", () => {
    const link = { key: KEY, url: STAKWORK_INDEX_URL };
    expect(linkIndexState(link, [])).toEqual({ state: "new", id: "index-stakwork-ai" });
    expect(linkIndexState(link, [{ id: "stakwork", key: KEY, urls: ["https://elsewhere.example/index/catalog"] }])).toEqual({ state: "followed", id: "stakwork" });
    const other = "y".repeat(52);
    expect(linkIndexState(link, [{ id: "index-stakwork-ai", key: other, urls: [STAKWORK_INDEX_URL] }])).toEqual({ state: "clash", id: "index-stakwork-ai", key: other });
  });
});

describe("what a package brings and can do", () => {
  it("counts what it brings and names what it reaches", () => {
    const can = { spends: true, acts: false, code: true };
    expect(bringsWords({ apps: [{ name: "desk", title: "Desk" }], workflows: 4, steps: 1, concepts: 0, secrets: [], can })).toEqual(["1 app", "4 workflows", "1 step"]);
    expect(canWords(can)).toEqual(["Spends model calls", "Runs code"]);
    expect(canWords({ spends: false, acts: false, code: false })).toEqual(["Only reads"]);
  });
});

describe("what an installed package holds", () => {
  const pkg = (items: InstalledPackage["items"]): InstalledPackage => ({ package: "openlaw/legal-desk", secrets: [], items });
  const many = (kind: "workflow" | "concept", n: number) => Array.from({ length: n }, (_, i) => ({ kind, name: `${kind}-${i}` }));

  it("names a few Concepts, and counts more: they can be hundreds", () => {
    expect(itemsByKind(pkg(many("concept", 5))).map((g) => [g.label, g.items.length, g.named])).toEqual([["Concepts", 5, true]]);
    expect(itemsByKind(pkg(many("concept", 752))).map((g) => [g.label, g.items.length, g.named])).toEqual([["Concepts", 752, false]]);
  });

  it("names the apps, workflows and steps people use, unless there are very many; leaves the helpers out", () => {
    const groups = itemsByKind(pkg([{ kind: "app", name: "openlaw/legal-desk/desk" }, ...many("workflow", 12), { kind: "step", name: "_http", helper: true }]));
    expect(groups.map((g) => [g.label, g.items.length, g.named])).toEqual([
      ["Apps", 1, true],
      ["Workflows", 12, true],
    ]);
    expect(itemsByKind(pkg(many("workflow", 13)))[0]?.named).toBe(false);
  });
});

describe("secrets", () => {
  const pkg: InstalledPackage = { package: "openlaw/legal-desk", secrets: ["COURTLISTENER_API_KEY", "SERPA_API_KEY"], items: [] };

  it("needs the ones the store has no value for, and claims none when strut could not say", () => {
    expect(secretsNeeded(pkg, new Set(["SERPA_API_KEY", "OTHER"]))).toEqual(["COURTLISTENER_API_KEY"]);
    expect(secretsNeeded(pkg, null)).toEqual([]);
  });

  it("sets only a name an installed package declares, never a setting stadeum keeps", () => {
    expect(settableSecret("COURTLISTENER_API_KEY", [pkg])).toBe(true);
    expect(settableSecret("GITHUB_TOKEN", [pkg])).toBe(false);
    expect(settableSecret("STRUT_DEFAULT_MODEL", [{ ...pkg, secrets: ["STRUT_DEFAULT_MODEL"] }])).toBe(false);
    expect(settableSecret("BAD-NAME", [{ ...pkg, secrets: ["BAD-NAME"] }])).toBe(false);
  });
});

describe("explainRefusal", () => {
  it("leads with plain words for strut's codes, then strut's own", () => {
    expect(explainRefusal("package_update_not_built: acme/x is installed here at sha256:aa", 409)).toBe(
      "Another version of this package is installed here. Uninstall it first, then install this one. Strut says: acme/x is installed here at sha256:aa",
    );
    expect(explainRefusal("package_busy: acme/x/sync has a run in flight", 409)).toMatch(/^One of its workflows is running\./);
    expect(explainRefusal("package_distro_owned: acme/x", 409)).toMatch(/only the distro updates or removes it/);
    expect(explainRefusal("package_conflict: a local workflow acme/x/sync", 409)).toMatch(/^Something on this box already uses a name/);
    expect(explainRefusal("catalog_seal: the signature does not verify", 409)).toMatch(/^The publisher’s catalog didn’t pass its checks.*Strut says: the signature does not verify$/);
  });

  it("passes anything else through, and says when strut gave no words", () => {
    expect(explainRefusal("ref is required", 400)).toBe("ref is required");
    expect(explainRefusal(undefined, 500)).toBe("Strut answered 500. Nothing changed.");
  });
});
