import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { appHref, earningsApp, earningsFor, launcherApps, listApps } from "./apps";

describe("launcherApps", () => {
  const app = (name: string, title: string, pinned?: boolean) => ({ name, title, activeVersion: "v1", ...(pinned ? { pinned } : {}) });

  it("puts the assistant first, then the pinned apps, then the rest by title", () => {
    const apps = launcherApps([
      app("acme/zeta", "Zeta"),
      app("acme/books", "Books"),
      app("acme/tax", "Tax", true),
      app("strut/jamie", "Jamie"),
      app("acme/alpha", "Alpha", true),
      app("acme/annual", "annual report"),
    ]);
    expect(apps.map((a) => a.name)).toEqual(["strut/jamie", "acme/alpha", "acme/tax", "acme/annual", "acme/books", "acme/zeta"]);
    expect(apps.filter((a) => a.assistant).map((a) => a.name)).toEqual(["strut/jamie"]);
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
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads strut's GET /apps into the launcher's order", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    fake.state.apps.push({ ...fake.state.apps[0]!, name: "acme/legal", title: "Legal", publisher: "acme" });
    expect(await listApps()).toEqual([
      { name: "strut/jamie", title: "Jamie", description: "Jamie, the person's assistant.", href: "/", assistant: true },
      { name: "acme/legal", title: "Legal", href: "/apps/acme%2Flegal", assistant: false },
    ]);
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

describe("earningsFor", () => {
  const earnings = { name: "strut/earnings", title: "Earnings", activeVersion: "v1", admin: true as const };
  const legal = { name: "acme/legal", title: "Legal", activeVersion: "v1" };

  it("is strut's Earnings for an admin when strut lists it", () => {
    expect(earningsFor("admin", [legal, earnings])).toEqual({ name: "strut/earnings", title: "Earnings" });
  });

  it("is none for an admin when strut lists no Earnings, or does not answer", () => {
    expect(earningsFor("admin", [legal])).toBeNull();
    expect(earningsFor("admin", null)).toBeNull();
  });

  it("is none for a member, even when strut lists it", () => {
    expect(earningsFor("member", [legal, earnings])).toBeNull();
  });
});

describe("earningsApp", () => {
  let fake: FakeStack;
  const saved = { ...process.env };

  beforeAll(async () => {
    fake = await startFakeStack({ token: "earnings-test-token" });
  });
  afterAll(() => fake.close());
  afterEach(() => {
    process.env = { ...saved };
  });

  it("finds Earnings in strut's listing for an admin, keeps it out of the launcher, and asks strut nothing for a member", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    expect(await earningsApp("admin")).toEqual({ name: "strut/earnings", title: "Earnings" });
    expect((await listApps())?.map((a) => a.name)).toEqual(["strut/jamie"]);
    const asked = fake.state.requests.length;
    expect(await earningsApp("member")).toBeNull();
    expect(fake.state.requests.length).toBe(asked);
  });

  it("is none for an admin on a strut seeded without it", async () => {
    Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });
    const kept = fake.state.apps;
    fake.state.apps = kept.filter((a) => a.name !== "strut/earnings");
    try {
      expect(await earningsApp("admin")).toBeNull();
    } finally {
      fake.state.apps = kept;
    }
  });
});
