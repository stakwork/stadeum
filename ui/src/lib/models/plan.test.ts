import { describe, expect, it } from "vitest";

import { FAKE_MODEL_CATALOG } from "@/test/fake-stack";
import { grantsFor, isModelName, parseModelsForm, planModels, priceTable, splitName } from "./plan";

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
    const plan = planModels({ models: null, defaultModel: null, prices: {} }, catalog, new Set(["anthropic", "openrouter"]));
    expect(plan.explicit).toBe(false);
    expect(plan.allowed).toEqual(["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5", "openrouter/moonshotai/kimi-k3"]);
    // Strut's own default, since its provider has a key.
    expect(plan.default).toBe("anthropic/claude-sonnet-5-5");
  });

  it("falls back to a keyed provider's default when strut's default has no key", () => {
    const plan = planModels({ models: null, defaultModel: null, prices: {} }, catalog, new Set(["google"]));
    expect(plan.allowed).toEqual(["google/gemini-3.8-flash"]);
    expect(plan.default).toBe("google/gemini-3.8-flash");
  });

  it("keeps the admin's list and default, dropping models whose provider lost its key", () => {
    const settings = { models: ["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna", "openrouter/deepseek/deepseek-v4"], defaultModel: "openai/gpt-5.6-luna", prices: {} };
    const plan = planModels(settings, catalog, new Set(["anthropic", "openrouter"]));
    expect(plan.explicit).toBe(true);
    expect(plan.allowed).toEqual(["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"]);
    // The saved default's provider has no key: the first allowed model that is some provider's default, else the first.
    expect(plan.default).toBe("anthropic/claude-opus-5-5");
  });

  it("has nothing to allow with no keys, and still names strut's default", () => {
    const plan = planModels({ models: null, defaultModel: null, prices: {} }, catalog, new Set());
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

const offered = new Set(["anthropic", "openai", "google", "xai", "openrouter", "maple", "numes", "together"]);

describe("parseModelsForm", () => {
  it("takes the ticked models, one typed in, and a default among them", () => {
    expect(
      parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: " openrouter/deepseek/deepseek-v4 ", default: "anthropic/claude-opus-5-5" }, offered),
    ).toEqual({ models: ["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"], defaultModel: "anthropic/claude-opus-5-5", prices: {} });
  });

  it("refuses an empty list, a default that is not allowed, and a name it does not know", () => {
    expect(parseModelsForm({ ticked: [], other: "", default: "" }, offered)).toEqual({ error: "Allow at least one model." });
    expect(parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: "", default: "openai/gpt-5.6-luna" }, offered)).toEqual({
      error: "Choose the default from the allowed models.",
    });
    expect(parseModelsForm({ ticked: ["anthropic/claude-opus-5-5"], other: "deepseek-v4", default: "anthropic/claude-opus-5-5" }, offered)).toMatchObject({
      error: expect.stringContaining("provider/id"),
    });
    expect(parseModelsForm({ ticked: ["acme/llama"], other: "", default: "acme/llama" }, offered)).toMatchObject({ error: expect.stringContaining("acme/llama") });
  });

  it("keeps a typed model's price, drops prices of models no longer allowed, and wants both prices", () => {
    const prices = { "together/old-model": { input: 1, output: 2 }, "together/kept": { input: 3, output: 4 } };
    expect(
      parseModelsForm(
        { ticked: ["together/kept"], other: "together/llama-4", default: "together/kept", otherInput: "$0.5", otherOutput: "1.5" },
        offered,
        prices,
      ),
    ).toEqual({
      models: ["together/kept", "together/llama-4"],
      defaultModel: "together/kept",
      prices: { "together/kept": { input: 3, output: 4 }, "together/llama-4": { input: 0.5, output: 1.5 } },
    });
    expect(parseModelsForm({ ticked: ["together/kept"], other: "together/x", default: "together/kept", otherInput: "1" }, offered)).toEqual({
      error: "Give both prices, input and output, or neither.",
    });
    expect(parseModelsForm({ ticked: ["together/kept"], other: "together/x", default: "together/kept", otherInput: "-1", otherOutput: "2" }, offered)).toMatchObject({
      error: expect.stringContaining("a number"),
    });
    // 0 is a price: free.
    expect(parseModelsForm({ ticked: ["together/kept"], other: "together/x", default: "together/kept", otherInput: "0", otherOutput: "0" }, offered)).toMatchObject({
      prices: { "together/x": { input: 0, output: 0 } },
    });
  });

  it("knows OpenRouter's rolling aliases, and only offered providers", () => {
    expect(isModelName("openrouter/~z-ai/glm-flash-latest", offered)).toBe(true);
    expect(isModelName("anthropic/claude opus", offered)).toBe(false);
    expect(isModelName("acme/llama-4", offered)).toBe(false);
    expect(isModelName("acme/llama-4", new Set(["acme"]))).toBe(true);
  });
});

describe("priceTable", () => {
  it("prices the catalog's own-rate models and the typed ones, keyed as the gateway sees a call", () => {
    const table = priceTable(
      {
        default: "",
        models: [
          { provider: "maple", modelId: "gemma4-31b", name: "maple/gemma4-31b", default: true, pricing: { inputTokenPrice: 0.8, outputTokenPrice: 2, cacheReadPrice: 0.1 } },
          { provider: "numes", modelId: "z-ai/glm-5.3", name: "numes/z-ai/glm-5.3", default: true, pricing: { inputTokenPrice: 0, outputTokenPrice: 0 } },
          { provider: "anthropic", modelId: "claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5", default: true },
        ],
      },
      { "together/llama-4": { input: 0.5, output: 1.5 } },
    );
    expect(table).toEqual({
      "maple/gemma4-31b": { input_per_mtok: 0.8, output_per_mtok: 2, cache_read_per_mtok: 0.1 },
      "numes/z-ai/glm-5.3": { input_per_mtok: 0, output_per_mtok: 0 },
      "together/llama-4": { input_per_mtok: 0.5, output_per_mtok: 1.5 },
    });
  });
});
