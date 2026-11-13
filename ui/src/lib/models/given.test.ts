import { afterEach, describe, expect, it, vi } from "vitest";

import { givenProviders } from "./given";

afterEach(() => vi.restoreAllMocks());

const read = (v: unknown) => givenProviders(JSON.stringify(v));

describe("providers given at install", () => {
  it("none when the setting is blank", () => {
    expect(givenProviders(undefined)).toEqual([]);
    expect(givenProviders("  ")).toEqual([]);
  });

  it("reads each entry: the provider, its key, and an address without a trailing slash", () => {
    expect(
      read([
        { provider: "anthropic", key: " sk-bf-1 ", url: "https://models.example.com/anthropic/" },
        { provider: "openrouter", key: "sk-or-2" },
      ]),
    ).toEqual([
      { id: "anthropic", key: "sk-bf-1", url: "https://models.example.com/anthropic" },
      { id: "openrouter", key: "sk-or-2" },
    ]);
  });

  it("leaves out what it cannot use, with a line in the log, and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      read([
        { provider: "google", key: "k" },
        { provider: "maple", key: "k" },
        { provider: "openai" },
        { provider: "openai", key: "has space" },
        { provider: "xai", key: "k", url: "ftp://x" },
        { provider: "gemini", key: "k" },
        { provider: "gemini", key: "k2" },
      ]),
    ).toEqual([{ id: "gemini", key: "k" }]);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('entry 1 left out: "google" is not one of anthropic, openai, gemini, xai, openrouter'),
      expect.stringContaining('entry 2 left out: "maple" is not one of'),
      expect.stringContaining("entry 3 left out: it has no key"),
      expect.stringContaining("entry 4 left out: it has no key"),
      expect.stringContaining("entry 5 left out: its url is not http(s)"),
      expect.stringContaining("entry 7 left out: gemini is given twice"),
    ]);
  });

  it("none, with a line in the log, when the setting is not a JSON list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(givenProviders("{not json")).toEqual([]);
    expect(givenProviders('{"provider":"anthropic","key":"k"}')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
