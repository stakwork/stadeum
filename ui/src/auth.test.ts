import { afterEach, describe, expect, it, vi } from "vitest";

// next-auth's entry imports next/server, which vitest's node env cannot resolve; only the provider list is under test.
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));

import { providers } from "./auth";

afterEach(() => {
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.AUTH_GOOGLE_SECRET;
});

describe("providers", () => {
  it("asks Google for its account picker", () => {
    process.env.AUTH_GOOGLE_ID = "id";
    process.env.AUTH_GOOGLE_SECRET = "secret";
    const google = providers().find((p) => (p as { id?: string }).id === "google") as {
      options?: { authorization?: { params?: Record<string, string> } };
    };
    expect(google.options?.authorization?.params?.prompt).toBe("select_account");
  });
});
