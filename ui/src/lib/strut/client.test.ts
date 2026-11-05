import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MothershipConfigError } from "@/lib/mothership/admin-credentials";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { brandProblem } from "@/test/strut-brand";
import { BrandUnsupportedError, embedUrl, getAppUsage, getAppVersions, getBrand, health, listApps, putBrand, setAppLive, setAppPinned, StrutHttpError } from "./client";

let fake: FakeStack;
const saved = { ...process.env };

beforeAll(async () => {
  fake = await startFakeStack({ token: "strut-test-token" });
});
afterAll(() => fake.close());
afterEach(() => {
  process.env = { ...saved };
});

function configure(over: Record<string, string | undefined> = {}) {
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    STRUT_URL: fake.strutUrl,
    STRUT_PUBLIC_URL: "https://strut.acme.example/",
    AUTH_URL: "https://acme.example/some/path",
  });
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("embedUrl", () => {
  it("frames {public strut}/ with a one-use ticket for the person, the app alone, our origin and its input", async () => {
    configure();
    const u = new URL(await embedUrl("ada-0f3c", "strut/jamie", "session=ada-0f3c/s1"));
    expect(u.origin).toBe("https://strut.acme.example");
    expect(u.pathname).toBe("/");
    expect([...u.searchParams.keys()]).toEqual(["ticket", "app", "solo", "embed_origin", "input"]);
    expect(u.searchParams.get("app")).toBe("strut/jamie");
    expect(u.search).toContain("app=strut%2Fjamie");
    expect(u.searchParams.get("solo")).toBe("1");
    expect(u.searchParams.get("embed_origin")).toBe("https://acme.example");
    expect(u.searchParams.get("input")).toBe("session=ada-0f3c/s1");

    const ticket = u.searchParams.get("ticket")!;
    expect(fake.state.tickets.get(ticket)?.actor).toBe("ada-0f3c");
    expect(u.toString()).not.toContain(fake.token);
    expect(fake.state.requests).toContain("POST /strut/auth/ticket");
  });

  it("mints a fresh ticket every time, and each opens the UI once", async () => {
    configure({ STRUT_PUBLIC_URL: undefined });
    const a = new URL(await embedUrl("ada-0f3c", "strut/jamie"));
    const b = new URL(await embedUrl("ada-0f3c", "strut/jamie"));
    expect(a.searchParams.get("ticket")).not.toBe(b.searchParams.get("ticket"));
    // Without a public URL the frame falls back to STRUT_URL.
    expect(`${a.origin}${a.pathname}`).toBe(`${fake.strutUrl}/`);
    expect(a.searchParams.has("input")).toBe(false);

    const first = await fetch(a);
    expect(first.status).toBe(200);
    const page = await first.text();
    expect(page).toContain("ada-0f3c");
    expect(page).toContain("Jamie");
    expect((await fetch(a)).status).toBe(401);
  });

  it("refuses without the shared token, and when strut rejects it", async () => {
    configure({ SHARED_API_TOKEN: undefined });
    await expect(embedUrl("ada-0f3c", "strut/jamie")).rejects.toBeInstanceOf(MothershipConfigError);
    configure({ SHARED_API_TOKEN: "wrong" });
    await expect(embedUrl("ada-0f3c", "strut/jamie")).rejects.toThrow("returned 401");
  });

  it("refuses when strut is down", async () => {
    configure();
    fake.state.down.strut = true;
    try {
      await expect(embedUrl("ada-0f3c", "strut/jamie")).rejects.toBeInstanceOf(StrutHttpError);
    } finally {
      fake.state.down.strut = false;
    }
  });
});

describe("listApps", () => {
  it("reads GET /apps with the key: name, title, description, pinned", async () => {
    configure();
    const apps = await listApps();
    expect(fake.state.requests).toContain("GET /strut/apps");
    expect(apps.map((a) => a.name)).toEqual(["strut/jamie", "strut/views"]);
    expect(apps[0]).toEqual({ name: "strut/jamie", title: "Jamie", description: "Jamie, the person's assistant.", activeVersion: "v1" });
  });

  it("falls back to the name for a title, and keeps pinned only when true", async () => {
    configure();
    const saved = fake.state.apps;
    fake.state.apps = [
      { ...saved[0]!, name: "acme/legal", title: "", pinned: true },
      { ...saved[0]!, name: "acme/books", title: "Books", pinned: false },
    ];
    try {
      expect(await listApps()).toEqual([
        { name: "acme/books", title: "Books", activeVersion: "v1" },
        { name: "acme/legal", title: "acme/legal", activeVersion: "v1", pinned: true },
      ]);
    } finally {
      fake.state.apps = saved;
    }
  });

  it("refuses with a key strut does not hold, and when strut is down", async () => {
    configure({ SHARED_API_TOKEN: "wrong" });
    await expect(listApps()).rejects.toThrow("GET /apps returned 401");
    configure();
    fake.state.down.strut = true;
    try {
      await expect(listApps()).rejects.toBeInstanceOf(StrutHttpError);
    } finally {
      fake.state.down.strut = false;
    }
  });
});

describe("an app's versions", () => {
  it("reads the versions, what is live and the releases, and makes changes as the actor", async () => {
    configure();
    fake.publish("acme/legal", "Legal");
    fake.publish("acme/legal");
    let v = await getAppVersions("acme/legal");
    expect(v).toMatchObject({ name: "acme/legal", active: "v2", live: "latest", releases: [] });
    expect(Object.keys(v.versions)).toEqual(["v1", "v2"]);
    expect(fake.state.requests).toContain("GET /strut/apps/acme%2Flegal/versions");

    // Holding at v1 makes a release, stamped with who asked; a publish is then a draft.
    expect(await setAppLive("acme/legal", { version: "v1" }, "ada-0f3c")).toEqual({ active: "v1", live: "r1" });
    fake.publish("acme/legal");
    v = await getAppVersions("acme/legal");
    expect(v).toMatchObject({ active: "v1", live: "r1", releases: [{ id: "r1", version: "v1", by: "ada-0f3c" }] });
    expect(Object.keys(v.versions)).toEqual(["v1", "v2", "v3"]);
    // The listing says the app is held.
    expect((await listApps()).find((a) => a.name === "acme/legal")).toMatchObject({ activeVersion: "v1", live: "r1" });

    await setAppLive("acme/legal", { version: "v3" }, "ada-0f3c");
    expect(await setAppLive("acme/legal", { release: "r1" }, "ada-0f3c")).toEqual({ active: "v1", live: "r1" });
    expect(await setAppLive("acme/legal", { version: "latest" }, "ada-0f3c")).toEqual({ active: "v3", live: "latest" });
  });

  it("refuses in strut's own words", async () => {
    configure();
    fake.publish("acme/tax", "Tax");
    await setAppLive("acme/tax", { version: "v1" }, "ada-0f3c");
    fake.state.refuseRelease = "release r1 locks workflow tax-run, which no longer exists";
    const err = await setAppLive("acme/tax", { release: "r1" }, "ada-0f3c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StrutHttpError);
    expect((err as StrutHttpError).status).toBe(409);
    expect((err as StrutHttpError).detail).toBe("release r1 locks workflow tax-run, which no longer exists");

    // A seeded app cannot be held; pinning it holds nothing.
    await expect(setAppLive("strut/jamie", { version: "v1" }, "ada-0f3c")).rejects.toMatchObject({ status: 409, detail: expect.stringMatching(/cannot be held/) });
    expect(await setAppPinned("strut/jamie", true, "ada-0f3c")).toEqual({ pinned: true, live: "latest" });
    await setAppPinned("strut/jamie", false, "ada-0f3c");
    expect((await getAppVersions("strut/jamie")).versions.v1?.source).toBe("seed");

    await expect(getAppVersions("acme/nope")).rejects.toMatchObject({ status: 404, detail: 'App "acme/nope" not found' });
  });

  it("pins: an app that follows latest is held at its live version", async () => {
    configure();
    fake.publish("acme/books", "Books");
    expect(await setAppPinned("acme/books", true, "ada-0f3c")).toEqual({ pinned: true, live: "r1" });
    expect(await getAppVersions("acme/books")).toMatchObject({ pinned: true, live: "r1", active: "v1" });
    // Unpinning leaves what is live alone.
    expect(await setAppPinned("acme/books", false, "ada-0f3c")).toEqual({ pinned: false, live: "r1" });
  });

  it("reads the last day's warnings", async () => {
    configure();
    fake.publish("acme/dash", "Dash");
    const warning = { kind: "fanout", version: "v1", times: 6, lastAt: new Date().toISOString(), message: "run/events called 214 times in 10 s", fix: "Gather it in one call." };
    fake.state.appRecords.get("acme/dash")!.warnings.push(warning);
    expect(await getAppUsage("acme/dash")).toEqual({ warnings: [warning] });
    expect((await listApps()).find((a) => a.name === "acme/dash")?.warnings).toBe(1);
  });
});

describe("the brand", () => {
  afterEach(() => {
    fake.state.brand = {};
  });

  it("starts empty: no brand, no styles", async () => {
    configure();
    expect(await getBrand()).toEqual({ brand: {}, styles: null });
    expect(fake.state.requests).toContain("GET /strut/brand");
  });

  it("saves the whole brand and reads back what strut keeps, with each theme's variables", async () => {
    configure();
    const saved = await putBrand({ color: "#0D9488", colorDark: "#2dd4bf", radius: "1rem", font: "Georgia, serif" });
    expect(saved.brand).toEqual({ color: "#0d9488", colorDark: "#2dd4bf", radius: "1rem", font: "Georgia, serif" });
    expect(saved.styles?.light.variables).toMatchObject({ "--color-background-inverse": "#0d9488", "--color-text-inverse": "#0a0a0a" });
    expect(saved.styles?.dark.variables).toMatchObject({ "--color-background-inverse": "#2dd4bf", "--border-radius-md": "1rem", "--font-sans": "Georgia, serif" });
    expect(fake.state.requests).toContain("PUT /strut/brand");
    expect(await getBrand()).toEqual(saved);
  });

  it("replaces it: a field left out or empty is unset, and {} resets", async () => {
    configure();
    await putBrand({ color: "#f80", radius: "0" });
    expect((await getBrand()).brand).toEqual({ color: "#ff8800", radius: "0" });
    expect((await putBrand({ radius: "0", font: "" })).brand).toEqual({ radius: "0" });
    expect(await putBrand({})).toEqual({ brand: {}, styles: null });
    expect(fake.state.brand).toEqual({});
  });

  it("refuses a bad field in strut's own words, and keeps the brand", async () => {
    configure();
    await putBrand({ color: "#0d9488" });
    for (const [bad, said] of [
      [{ color: "teal" }, "color is a hex color, #rrggbb"],
      [{ radius: "1.5" }, "radius is a length in px, rem or em (0.5rem, 6px)"],
      [{ font: "Georgia; color: red" }, 'font is a font-family list ("Avenir Next", system-ui, sans-serif)'],
      [{ colorDark: "#12345" }, "colorDark is a hex color, #rrggbb"],
      [{ radius: "10vh" }, "radius is a length in px, rem or em (0.5rem, 6px)"],
    ] as const) {
      const err = await putBrand(bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StrutHttpError);
      expect(err).toMatchObject({ status: 400, detail: said });
    }
    expect((await getBrand()).brand).toEqual({ color: "#0d9488" });
  });

  it("checks like strut: null and empty clear, a stranger field or a number is refused", () => {
    expect(brandProblem({ color: null, colorDark: "", radius: "0", font: '"Avenir Next", system-ui' })).toBeUndefined();
    expect(brandProblem({ radius: "6px" })).toBeUndefined();
    expect(brandProblem({ primary: "#fff" })).toMatch(/^unknown field "primary"/);
    expect(brandProblem({ radius: 6 })).toBe("radius is a string");
    expect(brandProblem([])).toBe("the brand is { color?, colorDark?, radius?, font? }");
    expect(brandProblem(undefined)).toBe("the brand is { color?, colorDark?, radius?, font? }");
  });

  it("sends only the brand's four fields", async () => {
    configure();
    const sneaky = { color: "#0d9488", primary: "#ff0000" } as Parameters<typeof putBrand>[0];
    expect((await putBrand(sneaky)).brand).toEqual({ color: "#0d9488" });
  });

  it("refuses with a key strut does not hold", async () => {
    configure({ SHARED_API_TOKEN: "wrong" });
    await expect(getBrand()).rejects.toMatchObject({ status: 401 });
    await expect(putBrand({})).rejects.toMatchObject({ status: 401 });
  });

  it("knows a strut older than branding: a 404, or its web UI's page in place of JSON", async () => {
    configure({ STRUT_URL: `${fake.base}/old-strut` });
    await expect(getBrand()).rejects.toBeInstanceOf(BrandUnsupportedError);
    configure();
    const spa = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<!doctype html><title>Strut</title>", { headers: { "Content-Type": "text/html" } }));
    try {
      await expect(getBrand()).rejects.toBeInstanceOf(BrandUnsupportedError);
    } finally {
      spa.mockRestore();
    }
  });
});

describe("health", () => {
  it("reads the keyed view, and only { ok } with a key strut does not hold", async () => {
    configure();
    const h = await health();
    expect(h.ok).toBe(true);
    expect(h.workspace?.backend).toBe("neo4j");
    expect(fake.state.requests).toContain("GET /strut/health");

    configure({ SHARED_API_TOKEN: "wrong" });
    expect(await health()).toEqual({ ok: true });
  });
});
