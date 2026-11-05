import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { managedApp, managedApps, versionsHref } from "./app-admin";
import { setAppLive, setAppPinned } from "./strut/client";

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "admin-test-token" });
});
afterAll(() => fake.close());
afterEach(() => {
  process.env = { ...saved };
});

const configure = () => Object.assign(process.env, { SHARED_API_TOKEN: fake.token, STRUT_URL: fake.strutUrl });

describe("managedApps", () => {
  it("lists every app a person opens, in the launcher's order, with what is live, drafts, pin and warnings", async () => {
    configure();
    fake.publish("acme/legal", "Legal");
    fake.publish("acme/books", "Books");
    fake.publish("acme/books");
    // Books held at v1, then two publishes: drafts.
    await setAppLive("acme/books", { version: "v1" }, "ada-0f3c");
    fake.publish("acme/books");
    fake.publish("acme/books");
    // Legal pinned: held at v1 by the pin.
    await setAppPinned("acme/legal", true, "ada-0f3c");
    fake.state.appRecords.get("acme/legal")!.warnings.push({ kind: "repeat", version: "v1", times: 2, lastAt: new Date().toISOString(), message: "m", fix: "f" });

    const apps = await managedApps();
    expect(apps.map((a) => a.name)).toEqual(["strut/jamie", "acme/legal", "acme/books"]);
    expect(apps[0]).toMatchObject({ title: "Jamie", seeded: true, held: false, drafts: 0, pinned: false });
    expect(apps[1]).toMatchObject({ title: "Legal", active: "v1", live: "r1", held: true, drafts: 0, pinned: true, warnings: 1, seeded: false });
    // v2, v3 and v4 are newer than the held v1 and were never made live: drafts, as strut's rows count them.
    expect(apps[2]).toMatchObject({ title: "Books", active: "v1", held: true, drafts: 3, pinned: false, warnings: 0 });
    expect(fake.state.requests).toContain("GET /strut/apps/acme%2Fbooks/versions");
    expect(fake.state.requests).not.toContain("GET /strut/apps/strut%2Fviews/versions");
  });
});

describe("managedApp", () => {
  it("reads one app with its versions and warnings, and nothing for a library or an unknown app", async () => {
    configure();
    const legal = await managedApp("acme/legal");
    expect(legal?.app.title).toBe("Legal");
    expect(Object.keys(legal!.versions.versions)).toEqual(["v1"]);
    expect(legal?.usage.map((w) => w.kind)).toEqual(["repeat"]);
    expect(await managedApp("strut/views")).toBeNull();
    expect(await managedApp("acme/nope")).toBeNull();
  });

  it("throws when strut is down, so the page can say so", async () => {
    configure();
    fake.state.down.strut = true;
    try {
      await expect(managedApp("acme/legal")).rejects.toThrow();
      await expect(managedApps()).rejects.toThrow();
    } finally {
      fake.state.down.strut = false;
    }
  });
});

describe("versionsHref", () => {
  it("encodes the name and the version", () => {
    expect(versionsHref("acme/hvac/invoices")).toBe("/apps/acme%2Fhvac%2Finvoices/versions");
    expect(versionsHref("strut/jamie", "v2")).toBe("/apps/strut%2Fjamie/versions/v2");
  });
});
