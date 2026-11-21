import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/access";
import { db } from "@/lib/db";
import { connectOffers } from "@/lib/connect";
import {
  connectFor,
  followedBySource,
  followedIdOf,
  followedSourceOf,
  followedState,
  installProgressText,
  installWatch,
  linkIndexState,
  parseInstallLink,
  parseRepositoryRef,
  refusalCode,
  secretsNeeded,
  SOFTWARE_REF,
  SOFTWARE_WORDS,
  softwareOf,
  subscriptionIdOf,
  type Followed,
} from "@/lib/packages";
import { listApps, listDeploymentSecretNames, listPackageIndexes, listPackageInstalls, listPackages, listPackageSubscriptions, startPackageInstall } from "@/lib/strut/client";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import {
  ACME_TOOLS_REPO,
  DOCS_DIGEST,
  fakeRepos,
  LEGAL_DESK,
  STAKWORK_INDEX_KEY,
  STAKWORK_INDEX_URL,
  STRUT_CODE_REPO,
  STRUT_GITHUB_REPO,
  STRUT_PODS_REPO,
  STRUT_SOFTWARE_REPO,
} from "@/test/strut-packages";

// Who is signed in: the real role check runs (lib/session.ts) on the person this email names.
const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { checkFollowed, findPackages, followedProgress, followIndex, followRepository, install, installFromRepository, installProgress, setSecret, uninstall, unfollow, unfollowIndex } =
  await import("./actions");
const { default: PackagesPage } = await import("./page");

/** The Packages page as the admin signed in gets it, rendered. */
const page = async () => renderToStaticMarkup(await PackagesPage({ searchParams: Promise.resolve({}) }));

let fake: FakeStack;
const saved = { ...process.env };
let adminActor = "";

beforeAll(async () => {
  fake = await startFakeStack({ token: "packages-test-token" });
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});
beforeEach(async () => {
  Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl, STADEUM_ALLOWED_DOMAINS: "acme.test" });
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  adminActor = (await admit("ada@acme.test")).user!.actor; // the first person: an admin
  await admit("ben@acme.test"); // a member
  who.email = "ada@acme.test";
  Object.assign(fake.state, { followed: [], installed: [], refusePackage: null, installMs: 0, installs: [], installWaits: false, requests: [] });
  Object.assign(fake.state, { repos: fakeRepos(), subscriptions: [], subscriptionPuts: [] });
  fake.state.deploymentSecrets.clear();
  fake.state.secrets.clear();
  fake.state.apps = fake.state.apps.filter((a) => a.name.startsWith("strut/"));
});
afterEach(() => {
  process.env = { ...saved };
});

const LINK = `?install=openlaw/legal-desk&index=${STAKWORK_INDEX_KEY}&index_url=${encodeURIComponent(STAKWORK_INDEX_URL)}`;
const packageCalls = () => fake.state.requests.filter((r) => r.includes("/strut/packages") || r.includes("/strut/secrets"));

/** Install as the page does: start it, then read it until it ends. */
async function installed(pkg: string, index: string, digest?: string) {
  const r = await install(pkg, index, digest);
  if (r.status === undefined) return r;
  let w: Awaited<ReturnType<typeof installProgress>> = r;
  for (let reads = 0; w.status === "queued" || w.status === "running"; reads++) {
    if (reads > 20) throw new Error("the install never ended");
    w = await installProgress(r.id);
  }
  return w;
}

async function followStakwork() {
  const r = await followIndex(STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL);
  if (r.error !== undefined) throw new Error(r.error);
  return r.index;
}

describe("the store's link", () => {
  it("follows the link's index on the admin's click, then installs only on the next", async () => {
    // The page reads the link and the indexes: the box follows none, so following comes first.
    const link = parseInstallLink(new URLSearchParams(LINK))!;
    expect(link).toEqual({ pkg: "openlaw/legal-desk", index: { key: STAKWORK_INDEX_KEY, url: STAKWORK_INDEX_URL } });
    expect(linkIndexState(link.index!, await listPackageIndexes())).toEqual({ state: "new", id: "index-stakwork-ai" });

    // Follow this index: filed under its host, by the link's key, its card read at once.
    const index = await followStakwork();
    expect(index).toMatchObject({ id: "index-stakwork-ai", key: STAKWORK_INDEX_KEY, urls: [STAKWORK_INDEX_URL], label: "index.stakwork.ai", read: { publishers: 2 } });
    expect(fake.state.followed).toEqual([{ id: "index-stakwork-ai", key: STAKWORK_INDEX_KEY, urls: [STAKWORK_INDEX_URL], label: "index.stakwork.ai" }]);
    expect(linkIndexState(link.index!, await listPackageIndexes())).toEqual({ state: "followed", id: "index-stakwork-ai" });

    // The confirmation's facts come from the search; nothing is installed yet.
    const found = await findPackages(link.pkg);
    if ("error" in found) throw new Error(found.error);
    const hit = found.hits.find((h) => h.package === link.pkg && h.index === "index-stakwork-ai")!;
    expect(hit).toMatchObject({ version: "1.0.0", digest: LEGAL_DESK.digest, publisher: "openlaw", license: "Apache-2.0" });
    expect(hit.detail).toMatchObject({ apps: [{ name: "desk", title: "Legal desk" }], workflows: 4, steps: 3, concepts: 12, can: { spends: true, acts: true, code: true } });
    expect(hit.detail?.secrets).toEqual(["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"]);
    expect(fake.state.installed).toEqual([]);
    expect(packageCalls()).not.toContain("POST /strut/packages/install");

    // Install: through the index the hit came from, at the release reviewed, as the admin.
    // Strut answers at once (`wait: false`) and the page reads the install until it ends.
    const started = await install(hit.package, hit.index, hit.digest);
    expect(started).toEqual({ id: expect.stringMatching(/^inst_[0-9a-f]{16}$/), ref: "openlaw/legal-desk", door: "install", status: "queued", phase: "queued" });
    if (started.status === undefined) throw new Error(started.error);
    expect(fake.state.installs.map((i) => i.id)).toEqual([started.id]);
    const r = await installProgress(started.id);
    expect(r).toEqual({
      id: started.id,
      ref: "openlaw/legal-desk",
      door: "install",
      status: "done",
      result: {
        package: "openlaw/legal-desk",
        version: "1.0.0",
        already: false,
        missingSecrets: ["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"],
        warnings: [],
      },
    });
    expect(fake.state.installed.map((p) => [p.release.package, p.actor])).toEqual([["openlaw/legal-desk", adminActor]]);
    // Its app is in everyone's list now.
    expect((await listApps()).map((a) => a.name)).toContain("openlaw/legal-desk/desk");
  });

  it("follows again as the same index when the box already has the key, and never replaces another key at that address", async () => {
    await followStakwork();
    expect((await followStakwork()).id).toBe("index-stakwork-ai");
    expect(fake.state.followed).toHaveLength(1);

    const other = "y".repeat(52);
    const r = await followIndex(other, STAKWORK_INDEX_URL);
    expect(r.error).toMatch(/already follows an index at index\.stakwork\.ai under another key/);
    expect(fake.state.followed.map((i) => i.key)).toEqual([STAKWORK_INDEX_KEY]);
  });

  it("refuses a key or an address strut would not follow, before asking it", async () => {
    expect((await followIndex("not-a-key", STAKWORK_INDEX_URL)).error).toMatch(/52 characters of z-base-32/);
    expect((await followIndex(STAKWORK_INDEX_KEY, "file:///etc/passwd")).error).toMatch(/starting https/);
    expect(packageCalls()).toEqual([]);
  });

  it("follows an index whose card can't be read, and says so", async () => {
    const r = await followIndex("y".repeat(52), "https://nowhere.example/index/catalog");
    expect(r.index).toMatchObject({ id: "nowhere-example" });
    expect(r.index?.error).toMatch(/package_index_unreachable/);
    const found = await findPackages("");
    expect("error" in found ? found.error : found.errors).toEqual([{ index: "nowhere-example", error: expect.stringMatching(/could not be read/) }]);
  });
});

describe("listing and search", () => {
  it("lists what is installed, its items and the keys it still needs", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    fake.state.deploymentSecrets.set("SERPA_API_KEY", "serpa-secret");

    const [pkg] = await listPackages();
    expect(pkg).toMatchObject({ package: "openlaw/legal-desk", version: "1.0.0", digest: LEGAL_DESK.digest, door: "install" });
    expect(pkg!.source?.url).toBe(LEGAL_DESK.urls[0]);
    expect(pkg!.items.filter((i) => !i.helper).map((i) => i.name)).toContain("openlaw/legal-desk/research");
    expect(pkg!.items.find((i) => i.name === "openlaw/legal-desk/_http")).toMatchObject({ kind: "step", helper: true });
    // GET /secrets says names, never values.
    expect(await listDeploymentSecretNames()).toEqual(["SERPA_API_KEY"]);
    expect(secretsNeeded(pkg!, new Set(await listDeploymentSecretNames()))).toEqual(["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON"]);
  });

  it("searches the indexes the box follows, and finds nothing while it follows none", async () => {
    let found = await findPackages("");
    expect("error" in found ? found.error : found.hits).toEqual([]);
    await followStakwork();
    found = await findPackages("");
    expect("error" in found ? found.error : found.hits.map((h) => h.package)).toEqual(["openlaw/legal-desk", "stakwork/docs-digest"]);
    found = await findPackages("weekly digest");
    expect("error" in found ? found.error : found.hits.map((h) => h.package)).toEqual(["stakwork/docs-digest"]);
    expect("error" in found ? null : found.hits[0]!.detail?.can).toEqual(DOCS_DIGEST.detail!.can);
    expect(fake.state.requests).toContain("GET /strut/packages/search");
  });

  it("says strut is not answering when it isn't", async () => {
    fake.state.down.strut = true;
    try {
      expect(await findPackages("")).toEqual({ error: expect.stringMatching(/isn’t answering/) });
    } finally {
      fake.state.down.strut = false;
    }
  });
});

describe("install's refusals", () => {
  it("says plainly when another version is installed, when nothing lists it, and when the box doesn't follow the index", async () => {
    // Strut takes the request, then refuses it as the install goes: the record says why.
    const lost = await installed("openlaw/legal-desk", "index-stakwork-ai");
    expect(lost).toMatchObject({ status: "failed", ref: "openlaw/legal-desk" });
    expect(lost.error).toMatch(/^This box doesn’t follow that index any more\./);
    await followStakwork();
    expect((await installed("nobody/nothing", "index-stakwork-ai")).error).toMatch(/^No index this box follows lists that publisher\./);
    expect((await installed("openlaw/legal-desk", "elsewhere")).error).toMatch(/^This box doesn’t follow that index any more\./);

    await installed("openlaw/legal-desk", "index-stakwork-ai");
    // The index lists a newer release; the box has the old one.
    fake.state.indexes.get(STAKWORK_INDEX_KEY)!.releases[0]!.digest = `sha256:${"9".repeat(64)}`;
    const r = await installed("openlaw/legal-desk", "index-stakwork-ai", `sha256:${"9".repeat(64)}`);
    expect(r.error).toMatch(/^Another version of this package is installed here\. Uninstall it first, then install this one\. Strut says: /);
    fake.state.indexes.get(STAKWORK_INDEX_KEY)!.releases[0]!.digest = LEGAL_DESK.digest;

    fake.state.refusePackage = { status: 409, error: "catalog_rollback: the catalog's seq 3 is below the 5 accepted" };
    expect((await installed("stakwork/docs-digest", "index-stakwork-ai")).error).toMatch(/^The publisher’s catalog didn’t pass its checks/);
  });

  it("says strut isn't answering when it can't start the install, and nothing starts", async () => {
    await followStakwork();
    process.env.STRUT_URL = "http://127.0.0.1:9"; // nothing listens there
    expect(await install("openlaw/legal-desk", "index-stakwork-ai")).toEqual({ error: "Strut isn’t answering. Nothing changed." });
    expect(fake.state.installs).toEqual([]);
  });

  it("refuses what isn't a package name, an index or a release before asking strut", async () => {
    for (const [pkg, index, digest] of [
      ["pk:abc/openlaw/legal-desk", "index-stakwork-ai", undefined],
      ["openlaw/legal-desk", "Bad Index", undefined],
      ["openlaw/legal-desk", "index-stakwork-ai", "sha256:short"],
    ] as const) {
      expect((await install(pkg, index, digest)).error).toBeTruthy();
    }
    expect(packageCalls()).toEqual([]);
  });
});

describe("an install as it goes", () => {
  it("says how far it is, phase by phase, and writes nothing until it ends", async () => {
    await followStakwork();
    fake.state.installMs = 60_000;
    const started = await install("openlaw/legal-desk", "index-stakwork-ai", LEGAL_DESK.digest);
    if (started.status === undefined) throw new Error(started.error);
    const rec = fake.state.installs.find((i) => i.id === started.id)!;
    // Halfway through strut's Concept pages.
    const at = rec.steps.findIndex((s) => s.phase === "concepts");
    rec.startedAt = Date.now() - ((at + 0.55) / rec.steps.length) * rec.ms;
    const w = await installProgress(started.id);
    expect(w).toEqual({ id: started.id, ref: "openlaw/legal-desk", door: "install", status: "running", phase: "concepts", package: "openlaw/legal-desk", done: 6, total: 12 });
    if (w.status === undefined) throw new Error(w.error);
    expect(installProgressText(w)).toEqual({ text: "Concepts 6 / 12", fraction: 0.5 });
    expect(fake.state.installed).toEqual([]);
    expect((await listApps()).map((a) => a.name)).not.toContain("openlaw/legal-desk/desk");

    // Then it ends, and the box has it.
    rec.startedAt = Date.now() - rec.ms - 1;
    expect(await installProgress(started.id)).toMatchObject({ status: "done", result: { package: "openlaw/legal-desk", version: "1.0.0", already: false } });
    expect(fake.state.installed.map((p) => p.release.package)).toEqual(["openlaw/legal-desk"]);
    expect((await listApps()).map((a) => a.name)).toContain("openlaw/legal-desk/desk");
  });

  it("shows an install another door started: the page reads strut's list of them", async () => {
    await followStakwork();
    fake.state.installMs = 60_000;
    // As a proposal someone accepted would: strut's install, not this page's.
    const other = await startPackageInstall("stakwork/docs-digest", {}, "someone-else");
    const running = (await listPackageInstalls()).filter((i) => i.finishedAt === undefined).map(installWatch);
    expect(running).toEqual([expect.objectContaining({ id: other.id, ref: "stakwork/docs-digest", door: "install" })]);
    expect(running[0]!.status === "queued" || running[0]!.status === "running").toBe(true);
    expect(fake.state.requests).toContain("GET /strut/packages/installs");
  });

  it("says when strut no longer knows the install, keeps trying while strut doesn't answer, and refuses what isn't an install", async () => {
    expect(await installProgress(`inst_${"0".repeat(16)}`)).toEqual({ error: expect.stringMatching(/^Strut no longer knows this install/), retry: false });
    fake.state.down.strut = true;
    try {
      expect(await installProgress(`inst_${"0".repeat(16)}`)).toEqual({ error: expect.stringMatching(/isn’t answering/), retry: true });
    } finally {
      fake.state.down.strut = false;
    }
    fake.state.requests = [];
    expect(await installProgress("../../secrets")).toEqual({ error: "That isn’t an install.", retry: false });
    expect(packageCalls()).toEqual([]);
  });

  it("takes a strut from before `wait`, which answers once the install is done", async () => {
    await followStakwork();
    fake.state.installWaits = true;
    expect(await install("openlaw/legal-desk", "index-stakwork-ai")).toMatchObject({ id: "", status: "done", result: { package: "openlaw/legal-desk", version: "1.0.0", already: false } });
    expect(fake.state.installed.map((p) => p.release.package)).toEqual(["openlaw/legal-desk"]);
  });
});

describe("uninstall", () => {
  it("uninstalls, takes its apps out of everyone's list, and says what it kept", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    fake.state.installed[0]!.modified.push("openlaw/legal-desk/research");

    const r = await uninstall("openlaw/legal-desk");
    expect(r.kept).toEqual([{ kind: "workflow", name: "openlaw/legal-desk/research", reason: expect.any(String) }]);
    expect(r.removed?.map((i) => i.name)).toContain("openlaw/legal-desk/desk");
    expect(await listPackages()).toEqual([]);
    expect((await listApps()).map((a) => a.name)).not.toContain("openlaw/legal-desk/desk");
    expect(fake.state.requests).toContain("DELETE /strut/packages/openlaw/legal-desk");
  });

  it("says plainly when a run is in flight, or the distro owns it", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    fake.state.refusePackage = { status: 409, error: "package_busy: openlaw/legal-desk/research has a run in flight" };
    expect((await uninstall("openlaw/legal-desk")).error).toMatch(/^One of its workflows is running\. Try again once the run is done\./);
    expect(await listPackages()).toHaveLength(1);

    fake.state.installed[0]!.door = "distro";
    expect((await uninstall("openlaw/legal-desk")).error).toMatch(/only that updates or removes it/);
    expect((await uninstall("acme/nothing")).error).toMatch(/^That package isn’t installed\./);
  });
});

describe("a missing secret", () => {
  it("sets a key an installed package reads, write-only, into strut's store", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    expect(await setSecret("COURTLISTENER_API_KEY", "  cl-secret  ")).toEqual({});
    expect(fake.state.deploymentSecrets.get("COURTLISTENER_API_KEY")).toBe("cl-secret");
    const [pkg] = await listPackages();
    expect(secretsNeeded(pkg!, new Set(await listDeploymentSecretNames()))).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"]);
  });

  it("refuses a name no installed package reads, a setting stadeum keeps, and an empty value", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    expect((await setSecret("GITHUB_TOKEN", "x")).error).toMatch(/No package installed here needs that secret set for the box/);
    expect((await setSecret("STRUT_DEFAULT_MODEL", "x")).error).toMatch(/No package installed here needs that secret set for the box/);
    expect((await setSecret("SERPA_API_KEY", "   ")).error).toMatch(/Paste the value first/);
    expect([...fake.state.deploymentSecrets.keys()]).toEqual([]);
  });

  it("offers no box-wide field for a secret a package reads only when set, nor one its own steps manage, a person's own, and refuses to set either; a required one still gets one", async () => {
    await followStakwork();
    await installed("openlaw/legal-desk", "index-stakwork-ai");
    const started = await installFromRepository(`${STRUT_GITHUB_REPO}@stable`);
    if (started.status === undefined) throw new Error(started.error);
    expect(await installProgress(started.id)).toMatchObject({ status: "done", result: { package: "stadeum/github", missingSecrets: [] } });

    // Strut reports what its steps read, which of those they read only when set, and what they provide.
    const listed = await listPackages();
    const github = listed.find((p) => p.package === "stadeum/github")!;
    const desk = listed.find((p) => p.package === "openlaw/legal-desk")!;
    expect(github).toMatchObject({ secrets: ["GITHUB_TOKEN"], optional: ["GITHUB_TOKEN"], provides: { secrets: ["GITHUB_TOKEN"] } });
    expect(desk).toMatchObject({ secrets: ["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY", "PACER_LOGIN"], optional: ["PACER_LOGIN"] });
    expect(desk.provides).toBeUndefined();
    const names = new Set(await listDeploymentSecretNames());
    expect(secretsNeeded(github, names)).toEqual([]);
    expect(secretsNeeded(desk, names)).toEqual(["COURTLISTENER_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SERPA_API_KEY"]);

    const html = await page();
    expect(html).toContain('for="secret-COURTLISTENER_API_KEY"');
    expect(html).not.toContain('for="secret-PACER_LOGIN"');
    expect(html).not.toContain('for="secret-GITHUB_TOKEN"');
    // Nor is a person's token said to be the box's, set.
    expect(html).not.toMatch(/Its keys are set: <span[^>]*>GITHUB_TOKEN/);

    expect((await setSecret("GITHUB_TOKEN", "a-box-token")).error).toMatch(/No package installed here needs that secret set for the box/);
    expect((await setSecret("PACER_LOGIN", "a-login")).error).toMatch(/No package installed here needs that secret set for the box/);
    expect(await setSecret("COURTLISTENER_API_KEY", "cl-secret")).toEqual({});
    expect([...fake.state.deploymentSecrets.keys()]).toEqual(["COURTLISTENER_API_KEY"]);
  });
});

describe("who may", () => {
  it("refuses a member every read and write, sending them home, and strut sees nothing", async () => {
    await followStakwork();
    fake.state.requests = [];
    who.email = "ben@acme.test";
    const home = expect.objectContaining({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/;/) });
    await expect(findPackages("")).rejects.toEqual(home);
    await expect(install("openlaw/legal-desk", "index-stakwork-ai")).rejects.toEqual(home);
    await expect(installProgress(`inst_${"0".repeat(16)}`)).rejects.toEqual(home);
    await expect(uninstall("openlaw/legal-desk")).rejects.toEqual(home);
    await expect(followIndex(STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL)).rejects.toEqual(home);
    await expect(unfollowIndex("index-stakwork-ai")).rejects.toEqual(home);
    await expect(setSecret("COURTLISTENER_API_KEY", "x")).rejects.toEqual(home);
    await expect(followRepository(`git+${STRUT_CODE_REPO}`)).rejects.toEqual(home);
    await expect(installFromRepository(`git+${STRUT_CODE_REPO}`)).rejects.toEqual(home);
    await expect(checkFollowed("strut-code-00000000")).rejects.toEqual(home);
    await expect(followedProgress("strut-code-00000000")).rejects.toEqual(home);
    await expect(unfollow("strut-code-00000000")).rejects.toEqual(home);
    // Nor the Software card, nor the page it is on.
    await expect(followRepository(SOFTWARE_REF)).rejects.toEqual(home);
    await expect(PackagesPage({ searchParams: Promise.resolve({}) })).rejects.toEqual(home);
    expect(packageCalls()).toEqual([]);
    expect(fake.state.installed).toEqual([]);
    expect(fake.state.subscriptionPuts).toEqual([]);
  });

  it("sends someone signed out to sign in", async () => {
    who.email = null;
    await expect(install("openlaw/legal-desk", "index-stakwork-ai")).rejects.toEqual(expect.objectContaining({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/signin;/) }));
  });

  it("lets an admin stop following an index", async () => {
    await followStakwork();
    expect(await unfollowIndex("index-stakwork-ai")).toEqual({});
    expect(fake.state.followed).toEqual([]);
  });
});

/** Wait for a read of something the box follows to end, as the page does: its last read newer than `before`, nothing installing. */
async function readEnds(id: string, before?: string) {
  for (let looks = 0; looks < 100; looks++) {
    const r = await followedProgress(id, before);
    if (r.error !== undefined) throw new Error(r.error);
    if (!r.followed) throw new Error(`${id} isn't followed`);
    if (r.followed.checkedAt && r.followed.checkedAt !== before && !r.install) return r.followed;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("the read never ended");
}

describe("from a repository", () => {
  const CODE = `git+${STRUT_CODE_REPO}@main`;
  const idOf = (ref: string) => {
    const r = parseRepositoryRef(ref);
    if ("error" in r) throw new Error(r.error);
    return subscriptionIdOf(r);
  };

  it("says what is wrong with a ref that isn't a repository's address, and sends strut nothing", async () => {
    for (const [ref, why] of [
      ["", /Give the repository’s address/],
      ["stakwork/strut-code", /isn’t a repository’s address/],
      ["git+ftp://example.test/a/b", /starts with https/],
      ["git@github.com:stakwork/strut-code.git", /SSH address/],
      ["git+https://bob:hunter2@example.test/acme/tools", /Leave the name and password out/],
      ["git+https://example.test/tools", /needs an owner and a name/],
      ["git+https://example.test/acme/tools@", /Nothing follows @/],
      ["git+https://example.test/acme/tools@bad..name", /isn’t a branch’s name/],
      ["git+https://example.test/acme/tools#", /Nothing follows #/],
      ["git+https://example.test/acme/tools#../etc", /isn’t a folder/],
      ["https://example.test/acme/tools?tab=readme", /no \?/],
    ] as const) {
      expect((await followRepository(ref)).error).toMatch(why);
      expect((await installFromRepository(ref)).error).toMatch(why);
    }
    // A commit never moves: it installs once, and isn't followed.
    expect((await followRepository(`${CODE.replace("@main", "")}@${"a1".repeat(20)}`)).error).toMatch(/A commit never moves/);
    expect(packageCalls()).toEqual([]);
    // The address alone is taken as the ref strut wants.
    expect(parseRepositoryRef(" https://example.test/acme/tools/ ")).toMatchObject({ ref: "git+https://example.test/acme/tools", source: "example.test/acme/tools" });
  });

  it("follows a repository as this admin: the actor beside the key, never a person in the body, and the package is theirs", async () => {
    const r = await followRepository(CODE);
    if (r.error !== undefined) throw new Error(r.error);
    const id = idOf(CODE);
    expect(r.followed).toMatchObject({ id, ref: CODE, actor: adminActor, whose: "ada@acme.test", mine: true });
    expect(fake.state.subscriptionPuts).toEqual([{ id, actor: adminActor, body: { ref: CODE } }]);

    // Strut reads it behind the answer; the page follows the read.
    const done = await readEnds(id, r.before);
    expect(done).toMatchObject({ applied: { commit: "a1".repeat(20) }, packages: [{ package: "stadeum/code", version: "0.1.0", diverged: [] }], mine: true });
    expect(done.error).toBeUndefined();
    expect(fake.state.installed.map((p) => [p.release.package, p.door, p.actor, p.source?.ref])).toEqual([["stadeum/code", "distro", adminActor, `subscription:${id}`]]);
    expect((await listPackages())[0]).toMatchObject({ package: "stadeum/code", door: "distro", source: { ref: `subscription:${id}` }, commit: "a1".repeat(20) });
    expect((await listApps()).map((a) => a.name)).toContain("stadeum/code/code");
  });

  it("follows the same repository again as the same subscription: on another branch, or as another admin, whose it then is", async () => {
    const first = await followRepository(`${STRUT_CODE_REPO}.git`);
    if (first.error !== undefined) throw new Error(first.error);
    await readEnds(first.followed.id);
    const cy = (await admit("cy@acme.test")).user!;
    await db.user.update({ where: { id: cy.id }, data: { role: "admin" } });
    who.email = "cy@acme.test";
    const again = await followRepository(CODE);
    if (again.error !== undefined) throw new Error(again.error);
    expect(again.followed.id).toBe(first.followed.id);
    expect(fake.state.subscriptions).toHaveLength(1);
    expect(fake.state.subscriptions[0]).toMatchObject({ ref: CODE, actor: cy.actor });
    expect(again.followed).toMatchObject({ actor: cy.actor, whose: "cy@acme.test", mine: true });
  });

  it("installs one once: a person's install of the ref, as this admin, followed as any install is, and the box follows nothing", async () => {
    const started = await installFromRepository(`${STRUT_CODE_REPO}@v0.1.0`);
    if (started.status === undefined) throw new Error(started.error);
    expect(started).toMatchObject({ ref: `git+${STRUT_CODE_REPO}@v0.1.0`, door: "install" });
    const w = await installProgress(started.id);
    expect(w).toMatchObject({ status: "done", result: { package: "stadeum/code", version: "0.1.0", already: false } });
    expect(fake.state.installed.map((p) => [p.release.package, p.door, p.actor, p.source?.ref])).toEqual([["stadeum/code", "install", adminActor, `git+${STRUT_CODE_REPO}@v0.1.0`]]);
    expect(fake.state.subscriptionPuts).toEqual([]);
    // Installed by a person, it is theirs to uninstall; a followed one is the distro's.
    expect((await uninstall("stadeum/code")).error).toBeUndefined();
  });

  it("says why a private repository can't be read, and which account to connect; once it can, waits for its key, then installs", async () => {
    Object.assign(process.env, { CONNECT_GITHUB_CLIENT_ID: "Iv23.test", CONNECT_GITHUB_CLIENT_SECRET: "test-secret" });
    const offers = connectOffers();
    expect(offers).toEqual([{ id: "github", name: "GitHub", secrets: ["GITHUB_TOKEN"] }]);

    const ref = `git+${ACME_TOOLS_REPO}#package`;
    const r = await followRepository(ref);
    if (r.error !== undefined) throw new Error(r.error);
    const denied = await readEnds(r.followed.id);
    expect(denied.error).toMatch(/^package_repo_denied: .* this subscription is .*'s, and is read with their own GITHUB_TOKEN alone/);
    expect(connectFor(refusalCode(denied.error), denied.error!, offers, denied.tokenSecret)).toEqual(offers[0]);
    expect(fake.state.installed).toEqual([]);
    // Once to install: the same refusal, the same account.
    const once = await installFromRepository(ref);
    if (once.status === undefined) throw new Error(once.error);
    const failed = await installProgress(once.id);
    if (failed.status !== "failed") throw new Error("it installed");
    expect(failed.error).toMatch(/^The repository can’t be read/);
    expect(connectFor(failed.code, failed.error, offers)).toEqual(offers[0]);

    // The admin connects their own account (the seam writes their GITHUB_TOKEN); a deployment's value is never read for it.
    fake.state.deploymentSecrets.set("GITHUB_TOKEN", "the-box-token");
    let c = await checkFollowed(r.followed.id);
    if (c.error !== undefined) throw new Error(c.error);
    expect((await readEnds(r.followed.id, c.before)).error).toMatch(/^package_repo_denied/);
    fake.state.secrets.set(`${adminActor}/GITHUB_TOKEN`, "ghu_ada");
    c = await checkFollowed(r.followed.id);
    if (c.error !== undefined) throw new Error(c.error);
    const waiting = await readEnds(r.followed.id, c.before);
    expect(waiting).toMatchObject({ waiting: { secrets: ["ACME_API_KEY"] }, packages: [] });
    expect(waiting.error).toBeUndefined();

    // The key it waits for may be set here, and it is read again at once.
    expect(await setSecret("ACME_API_KEY", "acme-key")).toEqual({});
    const installed = await readEnds(r.followed.id, waiting.checkedAt);
    expect(installed).toMatchObject({ packages: [{ package: "acme/tools", version: "1.2.0" }] });
    expect(installed.waiting).toBeUndefined();
  });

  it("offers no account to connect for a host no secret serves, as strut says it", async () => {
    Object.assign(process.env, { CONNECT_GITHUB_CLIENT_ID: "Iv23.test", CONNECT_GITHUB_CLIENT_SECRET: "test-secret" });
    // Strut's words (src/packages/git-source.ts), with no `tokenSecret` on the subscription: no account would be read.
    const words =
      "package_repo_denied: git+https://git.acme.test/acme/tools: https://git.acme.test/acme/tools asked for credentials — the repository is private or does not exist, and no secret serves git.acme.test here: a package declares the one that does (provides.git in its strut.yaml)";
    expect(connectFor(refusalCode(words), words, connectOffers(), undefined)).toBeUndefined();
  });

  it("checks it now, and stops following it: what it installed is uninstalled with it", async () => {
    fake.state.installMs = 30;
    const r = await followRepository(CODE);
    if (r.error !== undefined) throw new Error(r.error);
    const read = await readEnds(r.followed.id);

    // The branch moves: Check now reads it again, and the page sees its install going.
    const main = fake.state.repos.get(STRUT_CODE_REPO)!.refs.main!;
    Object.assign(main, { commit: "c3".repeat(20), release: { ...main.release, version: "0.2.0", digest: `sha256:${"5e".repeat(32)}` } });
    const c = await checkFollowed(r.followed.id);
    expect(c).toEqual({ before: read.checkedAt });
    let sawInstall = false;
    for (let looks = 0; looks < 100 && !sawInstall; looks++) {
      const p = await followedProgress(r.followed.id, read.checkedAt);
      sawInstall = !!(p.error === undefined && p.install?.door === "distro");
    }
    expect(sawInstall).toBe(true);
    expect(await readEnds(r.followed.id, read.checkedAt)).toMatchObject({ applied: { commit: "c3".repeat(20) }, packages: [{ package: "stadeum/code", version: "0.2.0" }] });

    // A person's uninstall can't take what the box follows; stopping does.
    expect((await uninstall("stadeum/code")).error).toMatch(/only that updates or removes it/);
    expect(await unfollow(r.followed.id)).toEqual({ uninstalled: ["stadeum/code"] });
    expect(fake.state.subscriptions).toEqual([]);
    expect(await listPackages()).toEqual([]);
    expect((await listApps()).map((a) => a.name)).not.toContain("stadeum/code/code");
    expect(await followedProgress(r.followed.id)).toEqual({ followed: null });
    expect((await checkFollowed(r.followed.id)).error).toMatch(/doesn’t follow that any more/);
    expect((await unfollow("../../secrets")).error).toBe("That isn’t something the box follows.");
  });
});

describe("a bundle, and the Software card", () => {
  const PARTS = [`git+${STRUT_GITHUB_REPO}@stable`, `git+${STRUT_PODS_REPO}@stable`, `git+${STRUT_CODE_REPO}@stable`];
  const idOf = (ref: string) => {
    const r = parseRepositoryRef(ref);
    if ("error" in r) throw new Error(r.error);
    return subscriptionIdOf(r);
  };
  const SOFTWARE = idOf(SOFTWARE_REF);
  /** A bundle's three parts, in its order. */
  const partsOf = (f: Followed) => {
    expect(f.parts).toHaveLength(3);
    return f.parts as [Followed, Followed, Followed];
  };
  /** What the box follows, as the page reads it. */
  const followedNow = async () => {
    const r = await followedProgress(SOFTWARE);
    if (r.error !== undefined) throw new Error(r.error);
    return r.followed;
  };

  it("follows the bundle as the admin who adds Software: one PUT of its ref alone, and every part it brings is theirs", async () => {
    expect(SOFTWARE_REF).toBe(`git+${STRUT_SOFTWARE_REPO}@stable`);
    let html = await page();
    expect(html).toContain(SOFTWARE_WORDS);
    expect(html).toContain("Add Software");
    expect(html).not.toContain("Remove Software");

    const r = await followRepository(SOFTWARE_REF);
    if (r.error !== undefined) throw new Error(r.error);
    expect(r.followed).toMatchObject({ id: SOFTWARE, ref: SOFTWARE_REF, actor: adminActor, whose: "ada@acme.test", mine: true });
    // One subscription, as this admin beside the key: no person, no secret, no package named.
    expect(fake.state.subscriptionPuts).toEqual([{ id: SOFTWARE, actor: adminActor, body: { ref: SOFTWARE_REF } }]);

    const done = await readEnds(SOFTWARE, r.before);
    expect(done.applied?.bundle).toEqual({ package: "stadeum/software", version: "0.1.0", refs: PARTS });
    expect(done.parts?.map((p) => [p.ref, p.actor, p.whose, p.mine])).toEqual(PARTS.map((ref) => [ref, adminActor, "ada@acme.test", true]));
    const [github, pods, code] = partsOf(done);
    expect(github).toMatchObject({ applied: { commit: "d4".repeat(20) }, packages: [{ package: "stadeum/github", version: "0.1.0" }], tokenSecret: "GITHUB_TOKEN" });
    expect(pods).toMatchObject({ waiting: { secrets: ["PODS_TOKEN", "PODS_URL"] }, packages: [] });
    expect(code).toMatchObject({ packages: [{ package: "stadeum/code", version: "0.1.0" }] });
    // The bundle's own: nothing installed of it, and its parts' packages and waits together.
    expect(done.applied?.packages).toEqual([]);
    expect(done.packages.map((p) => p.package)).toEqual(["stadeum/github", "stadeum/code"]);
    expect(done.waiting).toEqual({ secrets: ["PODS_TOKEN", "PODS_URL"] });
    expect(followedState(done)).toEqual({ tone: "attention", label: "Waiting for keys" });
    // Each package went in as this admin's, under its part, which names the bundle.
    expect(fake.state.installed.map((p) => [p.release.package, p.door, p.actor, followedIdOf(p.source?.ref), followedBySource([done], p.source?.ref)?.part?.ref])).toEqual([
      ["stadeum/github", "distro", adminActor, SOFTWARE, PARTS[0]],
      ["stadeum/code", "distro", adminActor, SOFTWARE, PARTS[2]],
    ]);
    expect(followedSourceOf(fake.state.installed[0]!.source?.ref)).toEqual({ id: SOFTWARE, part: github.id });

    // The card is on, and points at the bundle's row, which lists its parts.
    expect(softwareOf([done])).toBe(done);
    html = await page();
    expect(html).toContain("Remove Software");
    expect(html).not.toContain("Add Software");
    expect(html).toContain(`href="#followed-${SOFTWARE}"`);
    expect(html).toContain(`id="followed-${SOFTWARE}"`);
    expect(html).toMatch(/Bundle <span[^>]*>stadeum\/software<\/span> 0\.1\.0/);
    for (const ref of PARTS) expect(html).toContain(ref);
    expect(html).toContain('for="secret-PODS_TOKEN"');
    // stadeum/github's GITHUB_TOKEN is each person's, which the connect seam writes: never a box-wide field.
    expect(html).not.toContain('for="secret-GITHUB_TOKEN"');
    expect(html).toContain(`Kept up to date from ${PARTS[2]}, part of ${SOFTWARE_REF}, yours. Stop following the bundle below to remove it`);

    // A key a part waits for is set in place: the bundle is read again, and the part installs.
    for (const [name, value] of [
      ["PODS_URL", "https://pods.test"],
      ["PODS_TOKEN", "pods-token"],
    ]) {
      const before = (await followedNow())!.checkedAt;
      expect(await setSecret(name!, value!)).toEqual({});
      await readEnds(SOFTWARE, before);
    }
    const all = (await followedNow())!;
    expect(all.waiting).toBeUndefined();
    expect(all.parts![1]).toMatchObject({ packages: [{ package: "stadeum/pods", version: "0.4.0" }] });
    expect(followedState(all)).toEqual({ tone: "ok", label: "Up to date" });
  });

  it("shows a part another subscription holds, and a part strut can't read with the account to connect, each on its own beside the others", async () => {
    Object.assign(process.env, { CONNECT_GITHUB_CLIENT_ID: "Iv23.test", CONNECT_GITHUB_CLIENT_SECRET: "test-secret" });
    const offers = connectOffers();
    // stadeum/code was followed by hand first.
    const hand = await followRepository(`git+${STRUT_CODE_REPO}@main`);
    if (hand.error !== undefined) throw new Error(hand.error);
    await readEnds(hand.followed.id);
    // And stadeum/github's repository is private: read with the admin's own GitHub account alone, which isn't connected.
    fake.state.repos.get(STRUT_GITHUB_REPO)!.private = true;

    const r = await followRepository(SOFTWARE_REF);
    if (r.error !== undefined) throw new Error(r.error);
    const done = await readEnds(SOFTWARE, r.before);
    const [github, pods, code] = partsOf(done);
    // The bundle's own read went fine; each part says what stopped it.
    expect(done.error).toBeUndefined();
    expect(github.error).toMatch(/^package_repo_denied: .* this subscription is .*'s, and is read with their own GITHUB_TOKEN alone/);
    expect(connectFor(refusalCode(github.error), github.error!, offers, github.tokenSecret)).toEqual(offers[0]);
    expect(pods.waiting).toEqual({ secrets: ["PODS_TOKEN", "PODS_URL"] });
    expect(code).toMatchObject({ held: [{ package: "stadeum/code", by: `subscription:${hand.followed.id}` }], packages: [] });
    expect(done.held).toEqual(code.held);
    expect(followedBySource(await listPackageSubscriptions(), code.held![0]!.by)?.sub.id).toBe(hand.followed.id);
    expect([done, github, pods, code].map((f) => followedState(f).label)).toEqual(["A part’s last check failed", "Last check failed", "Waiting for keys", "Held by another"]);
    // stadeum/code stays the hand-followed one's.
    expect(fake.state.installed.find((p) => p.release.package === "stadeum/code")?.source?.ref).toBe(`subscription:${hand.followed.id}`);

    const html = await page();
    expect(html).toContain(`is left to git+${STRUT_CODE_REPO}@main, which keeps it up to date here`);
    expect(html).toContain("The repository can’t be read");
    expect(html).toContain('href="/api/connect/github?return=%2Fpackages"');

    // The admin connects GitHub and stops following stadeum/code by hand: at its next check, the bundle takes both.
    fake.state.secrets.set(`${adminActor}/GITHUB_TOKEN`, "ghu_ada");
    expect(await unfollow(hand.followed.id)).toEqual({ uninstalled: ["stadeum/code"] });
    expect(await page()).toContain(`was left to ${hand.followed.id}, which the box no longer follows: check now, and this takes it.`);
    const c = await checkFollowed(SOFTWARE);
    if (c.error !== undefined) throw new Error(c.error);
    const after = await readEnds(SOFTWARE, c.before);
    expect(after.parts!.map((p) => [p.error, p.held, p.packages.map((x) => x.package)])).toEqual([
      [undefined, undefined, ["stadeum/github"]],
      [undefined, undefined, []],
      [undefined, undefined, ["stadeum/code"]],
    ]);
    expect(fake.state.installed.find((p) => p.release.package === "stadeum/code")).toMatchObject({ actor: adminActor, source: { ref: `subscription:${after.parts![2]!.id}` } });

    // From a repository won't follow a second time a package the bundle keeps.
    expect((await followRepository(`git+${STRUT_CODE_REPO}@main`)).error).toBe(
      `The box follows that already, as part of ${SOFTWARE_REF}, and keeps it up to date with it. To follow it on its own, stop following that first.`,
    );
    expect(fake.state.subscriptions.map((s) => s.id)).toEqual([SOFTWARE]);
  });

  it("checks every part at once, shows the part installing in the bundle's row, and Remove Software takes every part's packages with it", async () => {
    const r = await followRepository(SOFTWARE_REF);
    if (r.error !== undefined) throw new Error(r.error);
    const read = await readEnds(SOFTWARE, r.before);

    // A part's branch moves: Check now reads the bundle, and the row sees that part's install going.
    fake.state.installMs = 30;
    const stable = fake.state.repos.get(STRUT_CODE_REPO)!.refs.stable!;
    Object.assign(stable, { commit: "c3".repeat(20), release: { ...stable.release, version: "0.2.0", digest: `sha256:${"5e".repeat(32)}` } });
    const c = await checkFollowed(SOFTWARE);
    expect(c).toEqual({ before: read.checkedAt });
    let going: string | undefined;
    for (let looks = 0; looks < 200 && !going; looks++) {
      const p = await followedProgress(SOFTWARE, read.checkedAt);
      if (p.error === undefined && p.followed && p.install) going = followedBySource([p.followed], p.install.ref)?.part?.ref;
    }
    expect(going).toBe(PARTS[2]);
    expect((await readEnds(SOFTWARE, read.checkedAt)).parts![2]).toMatchObject({ applied: { commit: "c3".repeat(20) }, packages: [{ package: "stadeum/code", version: "0.2.0" }] });

    // Another admin's Software is theirs: the card says whose.
    const cy = (await admit("cy@acme.test")).user!;
    await db.user.update({ where: { id: cy.id }, data: { role: "admin" } });
    who.email = "cy@acme.test";
    expect(await page()).toMatch(/On<\/span><span[^>]*> · ada@acme\.test’s\.<\/span>/);

    // Remove Software: the bundle's row's Stop following, every part's packages with it.
    expect((await uninstall("stadeum/code")).error).toMatch(/only that updates or removes it/);
    expect(await unfollow(SOFTWARE)).toEqual({ uninstalled: ["stadeum/github", "stadeum/code"] });
    expect(fake.state.subscriptions).toEqual([]);
    expect(await listPackages()).toEqual([]);
    expect((await listApps()).map((a) => a.name).filter((n) => n.startsWith("stadeum/"))).toEqual([]);
    expect(softwareOf(await listPackageSubscriptions())).toBeUndefined();
    const html = await page();
    expect(html).toContain("Add Software");
    expect(html).not.toContain("Remove Software");
  });
});
