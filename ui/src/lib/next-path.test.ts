import { describe, expect, it } from "vitest";

import { safeNext, signInHref } from "./next-path";

describe("safeNext", () => {
  it("keeps a path on this site, query and all", () => {
    const link = "/packages?install=openlaw%2Flegal-desk&index=abc&index_url=https%3A%2F%2Findex.stakwork.ai%2Findex%2Fcatalog";
    expect(safeNext(link)).toBe(link);
    expect(safeNext("/apps/acme%2Flegal")).toBe("/apps/acme%2Flegal");
  });

  it("refuses another host, a scheme, a control character, sign-in itself and the API", () => {
    for (const raw of ["//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "packages", "/a\nb", "/a\\b", "/signin", "/signin?next=/x", "/api/calls", "", null, 7]) {
      expect(safeNext(raw)).toBeNull();
    }
    expect(safeNext(`/${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("signInHref", () => {
  it("comes back to the page asked for, and plain /signin otherwise", () => {
    expect(signInHref("/packages?install=openlaw/legal-desk")).toBe("/signin?next=%2Fpackages%3Finstall%3Dopenlaw%2Flegal-desk");
    expect(signInHref("/")).toBe("/signin");
    expect(signInHref(null)).toBe("/signin");
    expect(signInHref("//evil.example")).toBe("/signin");
  });
});
