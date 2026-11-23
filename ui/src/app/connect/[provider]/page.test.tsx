import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import config from "../../../../next.config";

const who = vi.hoisted(() => ({ user: { actor: "ada-c1", role: "member", email: "ada@example.com" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => who.user }));

const { default: ConnectPage } = await import("./page");

const saved = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, {
    AUTH_URL: "https://acme.example.com",
    STRUT_PUBLIC_URL: "https://strut.acme.example.com",
    STADEUM_ORG_NAME: "Acme",
    CONNECT_GITHUB_CLIENT_ID: "Iv23.client",
    CONNECT_GITHUB_CLIENT_SECRET: "gh-secret",
    CONNECT_GITHUB_SLUG: "stadeum",
  });
  who.user = { actor: "ada-c1", role: "member", email: "ada@example.com" };
});
afterEach(() => {
  process.env = { ...saved };
});

async function page(search: Record<string, string>, provider = "github"): Promise<string> {
  const el = await ConnectPage({ params: Promise.resolve({ provider }), searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(el);
}

/** The Continue form's action, as the browser reads it: a POST, or nothing. */
const action = (html: string) => {
  const form = html.match(/<form[^>]*>/)?.[0];
  if (!form || !form.includes('method="post"')) return undefined;
  return form.match(/\saction="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
};

describe("the connect seam's confirm page", () => {
  it("says what the person connects, on which box, for themselves, and posts the same parameters to the seam", async () => {
    const html = await page({ return: "/apps/x" });
    expect(html).toContain("Connect GitHub");
    expect(html).toContain("acme.example.com");
    expect(html).toContain("Your agents will act as the GitHub account you choose next.");
    expect(action(html)).toBe("/api/connect/github?return=%2Fapps%2Fx");
    expect(html).toContain("Continue to GitHub");
    expect(html).toContain('href="https://acme.example.com/apps/x"');
  });

  it("is always for the person, a member or an admin, whatever a link says", async () => {
    for (const user of [who.user, { actor: "root-a1", role: "admin", email: "root@example.com" }]) {
      who.user = user;
      const html = await page({ for: "box", return: "/packages" });
      expect(html).toContain("Your agents will act as the GitHub account you choose next.");
      expect(html).not.toMatch(/for the box/i);
      expect(action(html)).toBe("/api/connect/github?for=box&return=%2Fpackages");
    }
  });

  it("says an install installs the app too", async () => {
    const html = await page({ install: "1" });
    expect(html).toContain("will also ask where to install the app");
    expect(action(html)).toBe("/api/connect/github?install=1");
  });

  it("refuses a return off the box, with no Continue and no way back there", async () => {
    const html = await page({ return: "https://evil.example/" });
    expect(html).toContain("The page to come back to is not on this site.");
    expect(action(html)).toBeUndefined();
    expect(html).not.toContain("evil.example");
  });

  it("is not found for a provider that isn't available", async () => {
    await expect(page({}, "slack")).rejects.toThrow();
    delete process.env.CONNECT_GITHUB_SLUG;
    delete process.env.CONNECT_GITHUB_CLIENT_SECRET;
    await expect(page({})).rejects.toThrow();
  });

  it("can't be framed", async () => {
    const rules = await config.headers!();
    const rule = rules.find((r) => r.source === "/connect/:path*");
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });
});
