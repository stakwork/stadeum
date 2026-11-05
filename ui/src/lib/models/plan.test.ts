import { describe, expect, it } from "vitest";

import { FAKE_MODEL_CATALOG } from "@/test/fake-stack";
import { grantsFor, isModelName, parseModelsForm, planModels, splitName } from "./plan";

const catalog = { default: FAKE_MODEL_CATALOG.default, models: FAKE_MODEL_CATALOG.models };

describe("splitName", () => {
  it("takes the first segment as the provider and keeps the rest as the id", () => {
    expect(splitName("anthropic/claude-sonnet-5-5")).toEqual({ provider: "anthropic", modelId: "claude-sonnet-5-5" });
    expect(splitName("openrouter/moonshotai/kimi-k3")).toEqual({ provider: "openrouter", modelId: "moonshotai/kimi-k3" });
    expect(splitName("sonnet")).toBeNull();
    expect(splitName("anthropic/")).toBeNull();
  });
});

describe("planModels", () => {
  it("allows every catalog model of a provider with a key until the admin saves a list", () => {
    const plan = planModels({ models: null, defaultModel: null }, catalog, new Set(["anthropic", "openrouter"]));
    expect(plan.explicit).toBe(false);
    expect(plan.allowed).toEqual(["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5", "openrouter/moonshotai/kimi-k3"]);
    // Strut's own default, since its provider has a key.
    expect(plan.default).toBe("anthropic/claude-sonnet-5-5");
  });

  it("falls back to a keyed provider's default when strut's default has no key", () => {
    const plan = planModels({ models: null, defaultModel: null }, catalog, new Set(["google"]));
    expect(plan.allowed).toEqual(["google/gemini-3.8-flash"]);
    expect(plan.default).toBe("google/gemini-3.8-flash");
  });

  it("keeps the admin's list and default, dropping models whose provider lost its key", () => {
    const settings = { models: ["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna", "openrouter/deepseek/deepseek-v4"], defaultModel: "openai/gpt-5.6-luna" };
    const plan = planModels(settings, catalog, new Set(["anthropic", "openrouter"]));
    expect(plan.explicit).toBe(true);
    expect(plan.allowed).toEqual(["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"]);
    // The saved default's provider has no key: the first allowed model that is some provider's default, else the first.
    expect(plan.default).toBe("anthropic/claude-opus-5-5");
  });

  it("has nothing to allow with no keys, and still names strut's default", () => {
    const plan = planModels({ models: null, defaultModel: null }, catalog, new Set());
    expect(plan.allowed).toEqual([]);
    expect(plan.default).toBe("anthropic/claude-sonnet-5-5");
  });
});

describe("grantsFor", () => {
  it("allows every model of every gateway provider until the admin saves a list", () => {
    expect(grantsFor(null, ["anthropic", "gemini"])).toEqual([
      { provider: "anthropic", allowed_models: ["*"] },
      { provider: "gemini", allowed_models: ["*"] },
    ]);
  });

  it("maps the list to each provider as bifrost names it, leaving off providers with none", () => {
    const grants = grantsFor(
      ["anthropic/claude-opus-5-5", "google/gemini-3.8-flash", "openrouter/moonshotai/kimi-k3", "anthropic/claude-opus-5-5"],
      ["anthropic", "openai", "gemini", "openrouter"],
    );
    expect(grants).toEqual([
      { provider: "anthropic", allowed_models: ["claude-opus-5-5"] },
      { provider: "gemini", allowed_models: ["gemini-3.8-flash"] },
      { provider: "openrouter", allowed_models: ["moonshotai/kimi-k3"] },
    ]);
  });

  it("drops a model whose provider the gateway does not have", () => {
    expect(grantsFor(["maple/gemma4-31b", "anthropic/claude-opus-5-5"], ["anthropic"])).toEqual([
      { provider: "anthropic", allowed_models: ["claude-opus-5-5"] },
    ]);
  });
});

describe("parseModelsForm", () => {
  it("takes the ticked models, one typed in, and a default among them", () => {
    expect(
      parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: " openrouter/deepseek/deepseek-v4 ", default: "anthropic/claude-opus-5-5" }),
    ).toEqual({ models: ["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"], defaultModel: "anthropic/claude-opus-5-5" });
  });

  it("refuses an empty list, a default that is not allowed, and a name it does not know", () => {
    expect(parseModelsForm({ ticked: [], other: "", default: "" })).toEqual({ error: "Allow at least one model." });
    expect(parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: "", default: "openai/gpt-5.6-luna" })).toEqual({
      error: "Choose the default from the allowed models.",
    });
    expect(parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: "deepseek-v4", default: "anthropic/claude-opus-5-5" })).toMatchObject({
      error: expect.stringContaining("provider/id"),
    });
    expect(parseModelsForm({ ticked: ["acme/llama"], other: "", default: "acme/llama" })).toMatchObject({ error: expect.stringContaining("acme/llama") });
  });

  it("knows OpenRouter's rolling aliases", () => {
    expect(isModelName("openrouter/~z-ai/glm-flash-latest")).toBe(true);
    expect(isModelName("anthropic/claude opus")).toBe(false);
  });
});
