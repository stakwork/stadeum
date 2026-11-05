import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MothershipConfigError } from "@/lib/mothership/admin-credentials";
import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { embedUrl, health, listApps, StrutHttpError } from "./client";

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
    expect(apps[0]).toEqual({ name: "strut/jamie", title: "Jamie", description: "Jamie, the person's assistant." });
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
        { name: "acme/books", title: "Books" },
        { name: "acme/legal", title: "acme/legal", pinned: true },
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
