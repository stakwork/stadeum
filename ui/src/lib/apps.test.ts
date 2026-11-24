import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { setAppPinned } from "./app-pins";
import { adminApps, adminAppsFor, appHref, isAdminOnly, launcherApps, listApps, railApps } from "./apps";

describe("launcherApps", () => {
  const app = (name: string, title: string) => ({ name, title, activeVersion: "v1" });

  it("puts the assistant first, then the rest by title", () => {
    const apps = launcherApps([
      app("acme/zeta", "Zeta"),
      app("acme/books", "Books"),
      app("acme/tax", "Tax"),
      app("strut/jamie", "Jamie"),
      app("acme/alpha", "Alpha"),
      app("acme/annual", "annual report"),
    ]);
    expect(apps.map((a) => a.name)).toEqual(["strut/jamie", "acme/alpha", "acme/annual", "acme/books", "acme/tax", "acme/zeta"]);
    expect(apps.filter((a) => a.assistant).map((a) => a.name)).toEqual(["strut/jamie"]);
  });

  it("pins every app but the ones an admin unpinned, so a new one is pinned", () => {
    const apps = launcherApps([app("acme/new", "New"), app("acme/off", "Off")], new Set(["acme/off"]));
    expect(apps.map((a) => [a.name, a.pinned])).toEqual([
      ["acme/new", true],
      ["acme/off", false],
    ]);
  });

  it("leaves out strut's component library", () => {
    expect(launcherApps([app("strut/views", "strut views"), app("acme/legal", "Legal")]).map((a) => a.name)).toEqual(["acme/legal"]);
  });

  it("leaves out an admin's app: the launcher is everyone's", () => {
    const apps = launcherApps([
      app("acme/legal", "Legal"),
      { ...app("strut/earnings", "Earnings"), admin: true as const },
      { ...app("acme/payroll", "Payroll"), admin: true as const },
    ]);
    expect(apps.map((a) => a.name)).toEqual(["acme/legal"]);
  });

  it("knows the assistant by its name before Jamie, on older strut images", () => {
    const [first] = launcherApps([app("acme/legal", "Legal"), app("strut/assistant", "Assistant")]);
    expect(first).toMatchObject({ name: "strut/assistant", assistant: true, href: "/" });
  });

  it("opens the assistant at home and every other app at its encoded name", () => {
    expect(appHref("strut/jamie")).toBe("/");
    expect(appHref("acme/hvac/invoices")).toBe("/apps/acme%2Fhvac%2Finvoices");
    expect(appHref("bench")).toBe("/apps/bench");
  });
});

describe("listApps", () => {
  let fake: FakeStack;
  const saved = { ...process.env };

  beforeAll(async () => {
    fake = await startFakeStack({ token: "apps-test-token" });
  });
  afterAll(() => fake.close());
  afterEach(async () => {
    process.env = { ...saved };
    await db.org.deleteMany();
  });

  it("reads strut's GET /apps into the launcher's order", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    fake.state.apps.push({ ...fake.state.apps[0]!, name: "acme/legal", title: "Legal", publisher: "acme" });
    expect(await listApps()).toEqual([
      { name: "strut/jamie", title: "Jamie", description: "Jamie, the person's assistant.", href: "/", assistant: true, pinned: true },
      { name: "acme/legal", title: "Legal", href: "/apps/acme%2Flegal", assistant: false, pinned: true },
    ]);
  });

  it("marks the apps an admin unpinned, and pins one again", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    await setAppPinned("acme/legal", false);
    await setAppPinned("acme/legal", false);
    expect((await listApps())?.map((a) => [a.name, a.pinned])).toEqual([
      ["strut/jamie", true],
      ["acme/legal", false],
    ]);
    await setAppPinned("acme/legal", true);
    expect((await listApps())?.find((a) => a.name === "acme/legal")?.pinned).toBe(true);
    expect((await db.org.findUnique({ where: { id: "org" } }))?.unpinnedApps).toBeNull();
  });

  it("is null, not an error, when strut does not answer", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.down.strut = true;
    try {
      expect(await listApps()).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /apps"));
    } finally {
      fake.state.down.strut = false;
      warn.mockRestore();
    }
  });
});

describe("adminAppsFor", () => {
  const earnings = { name: "strut/earnings", title: "Earnings", activeVersion: "v1", admin: true as const };
  const payroll = { name: "acme/payroll", title: "Payroll", activeVersion: "v1", admin: true as const };
  const legal = { name: "acme/legal", title: "Legal", activeVersion: "v1" };

  it("is strut's admin-only apps for an admin, by title: Earnings at its page, the rest at their name", () => {
    expect(adminAppsFor("admin", [payroll, legal, earnings]).map((a) => [a.name, a.href])).toEqual([
      ["strut/earnings", "/earnings"],
      ["acme/payroll", "/apps/acme%2Fpayroll"],
    ]);
  });

  it("is none for an admin when strut lists none, or does not answer", () => {
    expect(adminAppsFor("admin", [legal])).toEqual([]);
    expect(adminAppsFor("admin", null)).toEqual([]);
  });

  it("is none for a member, even when strut lists them", () => {
    expect(adminAppsFor("member", [legal, earnings, payroll])).toEqual([]);
  });
});

describe("railApps", () => {
  const strut = [
    { name: "strut/jamie", title: "Jamie", activeVersion: "v1" },
    { name: "acme/zeta", title: "Zeta", activeVersion: "v1" },
    { name: "acme/tax", title: "Tax", activeVersion: "v1" },
    { name: "strut/earnings", title: "Earnings", activeVersion: "v1", admin: true as const },
    { name: "strut/staff", title: "Workers", activeVersion: "v1", admin: true as const },
  ];
  const unpinned = new Set(["acme/zeta", "strut/earnings"]);

  it("puts every pinned app in an admin's rail, admin-only ones too, and leaves the unpinned ones out", () => {
    const { apps } = railApps(launcherApps(strut, unpinned), adminAppsFor("admin", strut, unpinned));
    expect(apps.map((a) => [a.name, a.href])).toEqual([
      ["strut/jamie", "/"],
      ["acme/tax", "/apps/acme%2Ftax"],
      ["strut/staff", "/apps/strut%2Fstaff"],
    ]);
  });

  it("is the pinned apps alone for a member: an unpinned one is out of sight", () => {
    const { apps } = railApps(launcherApps(strut, unpinned), adminAppsFor("member", strut, unpinned));
    expect(apps.map((a) => a.name)).toEqual(["strut/jamie", "acme/tax"]);
  });
});

describe("adminApps", () => {
  let fake: FakeStack;
  const saved = { ...process.env };

  beforeAll(async () => {
    fake = await startFakeStack({ token: "admin-apps-test-token" });
  });
  afterAll(() => fake.close());
  afterEach(() => {
    process.env = { ...saved };
  });

  it("finds the admin-only apps for an admin, keeps them out of the launcher, and asks strut nothing for a member", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    expect((await adminApps("admin")).map((a) => a.name)).toEqual(["strut/earnings"]);
    expect((await listApps())?.map((a) => a.name)).toEqual(["strut/jamie"]);
    const asked = fake.state.requests.length;
    expect(await adminApps("member")).toEqual([]);
    expect(fake.state.requests.length).toBe(asked);
  });

  it("is none for an admin on a strut seeded without Earnings", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    const kept = fake.state.apps;
    fake.state.apps = kept.filter((a) => a.name !== "strut/earnings");
    try {
      expect(await adminApps("admin")).toEqual([]);
    } finally {
      fake.state.apps = kept;
    }
  });

  it("knows an admin-only app by strut's flag, not its name", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    expect(await isAdminOnly("strut/earnings")).toBe(true);
    expect(await isAdminOnly("strut/jamie")).toBe(false);
    expect(await isAdminOnly("acme/unknown")).toBe(false);
  });
});
