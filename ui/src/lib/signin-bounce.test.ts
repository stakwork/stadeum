import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bounce, bounceOptions, labelState, unlabelState } from "./signin-bounce";

const authorize = "https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=eyJh.b.c.d.e&scope=openid";

beforeEach(() => {
  process.env.AUTH_URL = "https://acme.example.com";
  process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com/";
});
afterEach(() => {
  delete process.env.STADEUM_SIGNIN_BOUNCE;
  delete process.env.AUTH_URL;
});

describe("sign-in through a bounce", () => {
  it("is off without the setting, and changes nothing", () => {
    delete process.env.STADEUM_SIGNIN_BOUNCE;
    expect(bounce()).toBeUndefined();
    expect(bounceOptions()).toEqual({});
    expect(labelState(authorize)).toBe(authorize);
    const req = new NextRequest("https://acme.example.com/api/auth/callback/google?code=x&state=acme.eyJh");
    expect(unlabelState(req)).toBe(req);
  });

  it("is off for a bounce that is not https, or a host with no label", () => {
    process.env.STADEUM_SIGNIN_BOUNCE = "http://auth.example.com";
    expect(bounce()).toBeUndefined();
    process.env.STADEUM_SIGNIN_BOUNCE = "https://auth.example.com";
    process.env.AUTH_URL = "http://localhost:3000";
    expect(bounce()).toBeUndefined();
  });

  it("sends the provider to the bounce, at the box's own callback path", () => {
    expect(bounce()).toEqual({ origin: "https://auth.example.com", label: "acme" });
    // Auth.js adds /callback/<provider>: https://auth.example.com/api/auth/callback/google
    expect(bounceOptions()).toEqual({ redirectProxyUrl: "https://auth.example.com/api/auth" });
  });

  it("puts the box's label in front of the state, and nothing else changes", () => {
    const out = new URL(labelState(authorize));
    expect(out.searchParams.get("state")).toBe("acme.eyJh.b.c.d.e");
    expect(out.searchParams.get("client_id")).toBe("c");
    expect(out.searchParams.get("scope")).toBe("openid");
    expect(out.origin + out.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("leaves a URL with no state alone", () => {
    const none = "https://accounts.google.com/o/oauth2/v2/auth?client_id=c";
    expect(labelState(none)).toBe(none);
  });

  it("takes the label off a callback's state, keeping the rest of the request", () => {
    const req = new NextRequest(
      "https://acme.example.com/api/auth/callback/google?code=x&state=acme.eyJh.b.c.d.e&scope=openid",
      { headers: { cookie: "authjs.state=abc" } },
    );
    const out = unlabelState(req);
    expect(out.nextUrl.searchParams.get("state")).toBe("eyJh.b.c.d.e");
    expect(out.nextUrl.searchParams.get("code")).toBe("x");
    expect(out.nextUrl.pathname).toBe("/api/auth/callback/google");
    expect(out.headers.get("cookie")).toBe("authjs.state=abc");
  });

  it("leaves another box's label, an unlabelled state, and other routes alone", () => {
    for (const url of [
      "https://acme.example.com/api/auth/callback/google?code=x&state=other.eyJh",
      "https://acme.example.com/api/auth/callback/google?code=x&state=eyJh.b.c.d.e",
      "https://acme.example.com/api/auth/session?state=acme.eyJh",
    ]) {
      const req = new NextRequest(url);
      expect(unlabelState(req)).toBe(req);
    }
  });
});
