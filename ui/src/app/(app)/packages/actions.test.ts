import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/access";
import { db } from "@/lib/db";
import { installProgressText, installWatch, linkIndexState, parseInstallLink, secretsNeeded } from "@/lib/packages";
import { listApps, listDeploymentSecretNames, listPackageIndexes, listPackageInstalls, listPackages, startPackageInstall } from "@/lib/strut/client";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { DOCS_DIGEST, LEGAL_DESK, STAKWORK_INDEX_KEY, STAKWORK_INDEX_URL } from "@/test/strut-packages";

// Who is signed in: the real role check runs (lib/session.ts) on the person this email names.
const who = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { findPackages, followIndex, install, installProgress, setSecret, uninstall, unfollowIndex } = await import("./actions");

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
  fake.state.deploymentSecrets.clear();
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
    expect((await uninstall("openlaw/legal-desk")).error).toMatch(/only the distro updates or removes it/);
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
    expect((await setSecret("GITHUB_TOKEN", "x")).error).toMatch(/No package installed here reads that secret/);
    expect((await setSecret("STRUT_DEFAULT_MODEL", "x")).error).toMatch(/No package installed here reads that secret/);
    expect((await setSecret("SERPA_API_KEY", "   ")).error).toMatch(/Paste the value first/);
    expect([...fake.state.deploymentSecrets.keys()]).toEqual([]);
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
    expect(packageCalls()).toEqual([]);
    expect(fake.state.installed).toEqual([]);
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
