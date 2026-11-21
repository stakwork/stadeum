import { describe, expect, it } from "vitest";

import { STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL } from "@/test/strut-packages";
import {
  boxSecrets,
  bringsWords,
  canWords,
  connectFor,
  connectHref,
  explainRefusal,
  followedFrom,
  followedOf,
  followedState,
  indexIdOf,
  installProgressText,
  installWatch,
  itemsByKind,
  linkIndexState,
  parseInstallLink,
  parseRepositoryRef,
  refusalCode,
  secretsNeeded,
  settableSecret,
  subscriptionIdOf,
  type InstallWatch,
} from "./packages";
import type { InstalledPackage, PackageInstall } from "./strut/client";

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

  it("offers only what a package requires: never what its own steps manage, nor what it reads only when set, unless another package requires it", () => {
    const github: InstalledPackage = { package: "stadeum/github", secrets: ["GITHUB_TOKEN"], optional: ["GITHUB_TOKEN"], provides: { secrets: ["GITHUB_TOKEN"] }, items: [] };
    const all: InstalledPackage = {
      ...pkg,
      secrets: ["COURTLISTENER_API_KEY", "HOOK_SECRET", "PACER_LOGIN"],
      optional: ["PACER_LOGIN"],
      provides: { secrets: ["HOOK_SECRET"] },
    };
    expect(boxSecrets(github)).toEqual([]);
    expect(boxSecrets(all)).toEqual(["COURTLISTENER_API_KEY"]);
    expect(secretsNeeded(github, new Set())).toEqual([]);
    expect(secretsNeeded(all, new Set())).toEqual(["COURTLISTENER_API_KEY"]);
    expect(settableSecret("GITHUB_TOKEN", [github])).toBe(false);
    expect(settableSecret("HOOK_SECRET", [all])).toBe(false);
    expect(settableSecret("PACER_LOGIN", [all])).toBe(false);
    expect(settableSecret("COURTLISTENER_API_KEY", [all])).toBe(true);
    // A provided one with no `optional` (a strut from before it): still left out.
    expect(boxSecrets({ ...github, optional: undefined })).toEqual([]);
    // One general rule: a package that requires it makes it settable, whoever else provides it or reads it if set.
    expect(settableSecret("GITHUB_TOKEN", [github, { ...pkg, secrets: ["GITHUB_TOKEN"] }])).toBe(true);
    expect(settableSecret("PACER_LOGIN", [all, { ...pkg, secrets: ["PACER_LOGIN"] }])).toBe(true);
  });
});

describe("explainRefusal", () => {
  it("leads with plain words for strut's codes, then strut's own", () => {
    expect(explainRefusal("package_update_not_built: acme/x is installed here at sha256:aa", 409)).toBe(
      "Another version of this package is installed here. Uninstall it first, then install this one. Strut says: acme/x is installed here at sha256:aa",
    );
    expect(explainRefusal("package_busy: acme/x/sync has a run in flight", 409)).toMatch(/^One of its workflows is running\./);
    expect(explainRefusal("package_distro_owned: acme/x", 409)).toMatch(/only that updates or removes it/);
    expect(explainRefusal("package_conflict: a local workflow acme/x/sync", 409)).toMatch(/^Something on this box already uses a name/);
    expect(explainRefusal("catalog_seal: the signature does not verify", 409)).toMatch(/^The publisher’s catalog didn’t pass its checks.*Strut says: the signature does not verify$/);
  });

  it("passes anything else through, and says when strut gave no words", () => {
    expect(explainRefusal("ref is required", 400)).toBe("ref is required");
    expect(explainRefusal(undefined, 500)).toBe("Strut answered 500. Nothing changed.");
  });
});

describe("an install as it goes", () => {
  const going = (phase: string, more: { status?: "queued" | "running"; package?: string; done?: number; total?: number } = {}): InstallWatch => ({
    id: "inst_0123456789abcdef",
    ref: "openlaw/legal-desk",
    door: "install",
    status: "running",
    phase,
    ...more,
  });

  it("says what it is doing in strut's words, with how far when the phase counts", () => {
    expect(installProgressText(going("concepts", { done: 312, total: 752 }))).toEqual({ text: "Concepts 312 / 752", fraction: 312 / 752 });
    expect(installProgressText(going("apps", { done: 0, total: 2 }))).toEqual({ text: "Building the apps 0 / 2", fraction: 0 });
    expect(installProgressText(going("resolving"))).toEqual({ text: "Fetching the package" });
    expect(installProgressText(going("types", { total: 3 }))).toEqual({ text: "Graph types (3)" });
    expect(installProgressText(going("queued", { status: "queued" }))).toEqual({ text: "Waiting to start" });
    // A required package's phase names it.
    expect(installProgressText(going("steps", { package: "acme/base", done: 1, total: 4 })).text).toBe("Steps 1 / 4 · acme/base");
  });

  it("shows a phase it doesn't know by its name, and never runs past full", () => {
    expect(installProgressText(going("reindexing"))).toEqual({ text: "reindexing" });
    expect(installProgressText(going("concepts", { done: 9, total: 4 })).fraction).toBe(1);
    expect(installProgressText(going("concepts", { done: 0, total: 0 }))).toEqual({ text: "Concepts" });
  });

  it("reads strut's record: a result as the 201 gave it, a refusal in plain words", () => {
    const base: PackageInstall = { id: "inst_0123456789abcdef", ref: "openlaw/legal-desk", door: "install", status: "done", phase: "claims", startedAt: 1, finishedAt: 2 };
    const result = {
      package: "openlaw/legal-desk",
      packages: [
        { package: "acme/base", version: "2.0.0", status: "present", items: 3 },
        { package: "openlaw/legal-desk", version: "1.0.0", status: "installed", items: 20 },
      ],
      missingSecrets: ["SERPA_API_KEY"],
      warnings: ["a warning"],
    };
    expect(installWatch({ ...base, result })).toEqual({
      id: base.id,
      ref: base.ref,
      door: "install",
      status: "done",
      result: { package: "openlaw/legal-desk", version: "1.0.0", already: false, missingSecrets: ["SERPA_API_KEY"], warnings: ["a warning"] },
    });
    const present = { ...result, packages: result.packages.map((p) => ({ ...p, status: "present" })) };
    expect(installWatch({ ...base, result: present })).toMatchObject({ result: { already: true } });
    expect(installWatch({ ...base, status: "failed", error: "package_not_listed: no index lists acme" })).toEqual({
      id: base.id,
      ref: base.ref,
      door: "install",
      status: "failed",
      error: "No index this box follows lists that publisher. Strut says: no index lists acme",
      code: "package_not_listed",
    });
    expect(installWatch({ ...base, status: "running", phase: "concepts", done: 3, total: 9, package: "openlaw/legal-desk" })).toEqual({
      id: base.id,
      ref: base.ref,
      door: "install",
      status: "running",
      phase: "concepts",
      package: "openlaw/legal-desk",
      done: 3,
      total: 9,
    });
  });
});

describe("parseRepositoryRef", () => {
  it("reads a repository's ref as strut does: the address, a branch after @, a folder after #", () => {
    expect(parseRepositoryRef("git+https://github.com/stakwork/strut-code@stable#package")).toEqual({
      ref: "git+https://github.com/stakwork/strut-code@stable#package",
      address: "https://github.com/stakwork/strut-code",
      rev: "stable",
      folder: "package",
      source: "github.com/stakwork/strut-code#package",
      commit: false,
    });
    // Without git+, with a trailing slash or .git: the same package, the ref strut wants.
    expect(parseRepositoryRef("  https://GitHub.com/Stakwork/strut-code.git/ ")).toMatchObject({ ref: "git+https://github.com/Stakwork/strut-code.git", source: "github.com/stakwork/strut-code" });
    expect(parseRepositoryRef("git+https://git.acme.test/group/sub/tools@feature/x")).toMatchObject({ rev: "feature/x", source: "git.acme.test/group/sub/tools" });
    expect(parseRepositoryRef(`git+https://example.test/a/b@${"0f".repeat(20)}`)).toMatchObject({ commit: true });
    expect(parseRepositoryRef("git+http://localhost:3000/a/b")).toMatchObject({ ref: "git+http://localhost:3000/a/b" });
  });

  it("says plainly what is wrong with what isn't a repository's address", () => {
    const why = (raw: string) => {
      const r = parseRepositoryRef(raw);
      return "error" in r ? r.error : null;
    };
    expect(why("openlaw/legal-desk")).toMatch(/isn’t a repository’s address/);
    expect(why("file:///srv/repo")).toMatch(/starts with https/);
    expect(why("ssh://git@example.test/a/b")).toMatch(/SSH address/);
    expect(why("git+https://user@example.test/a/b")).toMatch(/Leave the name and password out/);
    expect(why("git+https://user:tok@example.test/a/b@main")).toMatch(/Leave the name and password out/);
    expect(why("https://example.test/")).toMatch(/needs an owner and a name/);
    expect(why("https://example.test/a/-b")).toMatch(/“-b” can’t be part/);
    expect(why("https://example.test/a/b@x.lock")).toMatch(/isn’t a branch’s name/);
    expect(why("https://example.test/a/b#a/../b")).toMatch(/isn’t a folder/);
  });
});

describe("what the box follows", () => {
  it("files a repository's package under one id, whatever the branch or spelling", () => {
    const id = (raw: string) => {
      const r = parseRepositoryRef(raw);
      if ("error" in r) throw new Error(r.error);
      return subscriptionIdOf(r);
    };
    expect(id("git+https://github.com/stakwork/strut-code@main")).toMatch(/^strut-code-[0-9a-f]{8}$/);
    expect(id("https://GitHub.com/stakwork/strut-code.git")).toBe(id("git+https://github.com/stakwork/strut-code@main"));
    expect(id("git+https://github.com/stakwork/strut-code#package")).not.toBe(id("git+https://github.com/stakwork/strut-code"));
    expect(id("git+https://elsewhere.test/stakwork/strut-code")).not.toBe(id("git+https://github.com/stakwork/strut-code"));
    expect(id(`git+https://example.test/a/${"x".repeat(80)}`)).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
  });

  it("says where it comes from, whose it is and how it stands", () => {
    const sub = { id: "code", ref: "git+https://example.test/a/b", warnings: [], packages: [] };
    expect(followedFrom(sub)).toBe("git+https://example.test/a/b");
    expect(followedFrom({ id: "acme", url: "https://central.example/lab", channel: "stable" })).toBe("central.example, channel stable");
    const [mine, theirs, nobodys] = followedOf(
      [
        { ...sub, actor: "ada-1" },
        { ...sub, actor: "bob-2" },
        { ...sub, actor: undefined },
      ],
      new Map([["ada-1", "Ada"]]),
      "ada-1",
    );
    expect(mine).toMatchObject({ whose: "Ada", mine: true });
    expect(theirs).toMatchObject({ whose: "bob-2", mine: false });
    expect(nobodys).toMatchObject({ mine: false });
    expect(nobodys!.whose).toBeUndefined();
    expect(followedState({})).toEqual({ tone: "pending", label: "Not read yet" });
    expect(followedState({ checkedAt: "2026-11-20T00:00:00Z" })).toEqual({ tone: "ok", label: "Up to date" });
    expect(followedState({ checkedAt: "x", waiting: { secrets: ["K"] } })).toEqual({ tone: "attention", label: "Waiting for keys" });
    expect(followedState({ checkedAt: "x", error: "package_repo_denied: …" })).toEqual({ tone: "attention", label: "Last check failed" });
  });

  it("offers the account to connect only when strut couldn't read a repository, by the secret strut names", () => {
    const offers = [
      { id: "github", name: "GitHub", secrets: ["GITHUB_TOKEN"] },
      { id: "forge", name: "Forge", secrets: ["FORGE_TOKEN"] },
    ];
    const denied = "package_repo_denied: git+https://example.test/a/b: https://example.test/a/b asked for credentials — set the secret FORGE_TOKEN to a token that can read it";
    expect(refusalCode(denied)).toBe("package_repo_denied");
    expect(connectFor(refusalCode(denied), denied, offers)?.id).toBe("forge");
    expect(connectFor("package_repo_denied", "no name here", offers, "GITHUB_TOKEN")?.id).toBe("github");
    expect(connectFor("package_repo_denied", "no name here", offers)).toBeUndefined();
    expect(connectFor("package_repo_unreachable", denied, offers)).toBeUndefined();
    expect(connectHref(offers[0]!)).toBe("/api/connect/github?return=%2Fpackages");
  });

  it("lets a key a followed package waits for be set, as an installed package's is", () => {
    expect(settableSecret("ACME_API_KEY", [], [{ waiting: { secrets: ["ACME_API_KEY"] } }])).toBe(true);
    expect(settableSecret("ACME_API_KEY", [], [{}])).toBe(false);
    expect(settableSecret("STRUT_MODELS", [], [{ waiting: { secrets: ["STRUT_MODELS"] } }])).toBe(false);
  });
});
