import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ensureGatewayLogRetention } from "@/lib/mothership/gateway-settings";
import { ensureVirtualKey } from "@/lib/mothership/virtual-key";
import { startFakeStack, type FakeKey, type FakeStack } from "@/test/fake-stack";
import { allowProviderModels, applyModels, modelsView, STRUT_DEFAULT_MODEL, STRUT_MODELS } from "./apply";
import { GIVEN_REFUSAL } from "./given";
import {
  addOtherProvider,
  applyGivenProviders,
  checkProviderKey,
  otherNameProblem,
  providerSays,
  providerStates,
  removeProviderKey,
  setProviderKey,
} from "./providers";
import { readModelSettings, saveModelSettings } from "./settings";

let fake: FakeStack;

beforeAll(async () => {
  fake = await startFakeStack({ providers: ["anthropic", "openai", "gemini", "xai", "openrouter"] });
  Object.assign(process.env, {
    SHARED_API_TOKEN: fake.token,
    BIFROST_URL: fake.bifrostUrl,
    BIFROST_ADMIN_PASS: fake.adminPass,
    STRUT_URL: fake.strutUrl,
  });
  await db.mothershipUser.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
  await db.org.deleteMany();
});
afterAll(async () => {
  await fake.close();
  await db.$disconnect();
});
beforeEach(() => {
  fake.state.down.bifrost = false;
  fake.state.down.strut = false;
});

const slot = (p: string): FakeKey => fake.state.providerKeys.get(p)![0]!;

describe("provider keys", () => {
  it("starts with each provider's empty env slot: no key anywhere", async () => {
    const states = await providerStates();
    // The built-ins, then Maple and Numes, which the gateway holds only once a key is set.
    expect(states.map((s) => [s.id, s.kind])).toEqual([
      ["anthropic", "builtin"],
      ["openai", "builtin"],
      ["gemini", "builtin"],
      ["xai", "builtin"],
      ["openrouter", "builtin"],
      ["maple", "known"],
      ["numes", "known"],
    ]);
    expect(states.every((s) => s.preview === "" && !s.missing)).toBe(true);
  });

  it("replaces the env slot in place, under its name, and the gateway checks the key", async () => {
    const before = slot("anthropic");
    const state = await setProviderKey("anthropic", "sk-good-anthropic-1234");
    expect(state).toMatchObject({ id: "anthropic", strut: "anthropic", kind: "builtin", preview: "sk-****1234", check: { ok: true } });
    const keys = fake.state.providerKeys.get("anthropic")!;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ id: before.id, name: "anthropic-key-1", value: "sk-good-anthropic-1234", models: ["*"], weight: 1 });
    // Only bifrost's masked preview ever comes back.
    expect(JSON.stringify(await providerStates())).not.toContain("sk-good-anthropic-1234");
  });

  it("reports a key the provider refuses, in its words", async () => {
    const state = await setProviderKey("openai", "sk-bad-openai-9999");
    // The provider's sentence, out of bifrost's wrapper.
    expect(state.check).toEqual({ ok: false, detail: "Incorrect API key provided." });
    expect((await checkProviderKey("openai")).check).toEqual({ ok: false, detail: "Incorrect API key provided." });
  });

  it("adds a key to a provider that has no slot left", async () => {
    await removeProviderKey("openai");
    expect(fake.state.providerKeys.get("openai")).toEqual([]);
    const state = await setProviderKey("openai", "sk-good-openai-5555");
    expect(state.check?.ok).toBe(true);
    expect(fake.state.providerKeys.get("openai")![0]).toMatchObject({ name: "openai-key-1", value: "sk-good-openai-5555" });
  });

  it("says when the gateway has no such provider", async () => {
    fake.state.providerKeys.delete("xai");
    expect((await providerStates()).find((s) => s.id === "xai")).toMatchObject({ missing: true, preview: "" });
    await expect(setProviderKey("xai", "sk-good-x")).rejects.toThrow("no xAI provider");
    await expect(setProviderKey("nope", "sk-good-x")).rejects.toThrow("not a provider stadeum offers");
  });
});

describe("providerSays", () => {
  it("takes the provider's sentence out of bifrost's wrapper, or keeps the words as they are", () => {
    expect(providerSays('provider API error: {"code":"invalid-argument","error":"Incorrect API key provided."}')).toBe("Incorrect API key provided.");
    expect(providerSays('provider API error: {"error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toBe("invalid x-api-key");
    expect(providerSays("dial tcp: lookup api.x.ai: no such host")).toBe("dial tcp: lookup api.x.ai: no such host");
    expect(providerSays(undefined)).toBeUndefined();
  });
});

describe("applyModels", () => {
  it("leaves every key allowing everything, and tells strut the keyed catalog, until the admin saves a list", async () => {
    const ada = await db.user.create({ data: { email: "ada@acme.test", actor: "ada-0001" } });
    const vk = await ensureVirtualKey(ada);
    const r = await applyModels();
    expect(r).toEqual({ updated: 0, failed: 0, strut: true, prices: true });
    const configs = fake.state.vks.find((v) => v.id === vk.vkId)!.provider_configs as Array<{ provider: string; allowed_models: string[] }>;
    // Every provider the gateway lists, keyed or not, as before.
    expect(configs.map((c) => [c.provider, c.allowed_models])).toEqual([
      ["anthropic", ["*"]],
      ["openai", ["*"]],
      ["gemini", ["*"]],
      ["xai", ["*"]],
      ["openrouter", ["*"]],
    ]);
    expect(fake.state.deploymentSecrets.get(STRUT_DEFAULT_MODEL)).toBe("anthropic/claude-sonnet-5-5");
    expect(JSON.parse(fake.state.deploymentSecrets.get(STRUT_MODELS)!)).toEqual([
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-opus-5-5",
      "openai/gpt-5.6-luna",
    ]);
  });

  it("narrows every person's key to the saved list, keeping config ids, and tells strut", async () => {
    const bo = await db.user.create({ data: { email: "bo@acme.test", actor: "bo-0002" } });
    await ensureVirtualKey(bo);
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna"], defaultModel: "openai/gpt-5.6-luna", prices: {} });
    expect(await applyModels()).toEqual({ updated: 2, failed: 0, strut: true, prices: true });
    for (const vk of fake.state.vks) {
      const configs = vk.provider_configs as Array<{ id: number; provider: string; allowed_models: string[] }>;
      expect(configs.map((c) => [c.id, c.provider, c.allowed_models])).toEqual([
        [1, "anthropic", ["claude-opus-5-5"]],
        [2, "openai", ["gpt-5.6-luna"]],
      ]);
    }
    expect(fake.state.deploymentSecrets.get(STRUT_DEFAULT_MODEL)).toBe("openai/gpt-5.6-luna");
    expect(JSON.parse(fake.state.deploymentSecrets.get(STRUT_MODELS)!)).toEqual(["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna"]);
    // A second pass changes nothing.
    expect((await applyModels()).updated).toBe(0);
    // A new person's key is made with the list.
    const cy = await db.user.create({ data: { email: "cy@acme.test", actor: "cy-0003" } });
    const cyKey = await ensureVirtualKey(cy);
    const cyConfigs = fake.state.vks.find((v) => v.id === cyKey.vkId)!.provider_configs as Array<{ provider: string; allowed_models: string[] }>;
    expect(cyConfigs.map((c) => c.provider)).toEqual(["anthropic", "openai"]);
  });

  it("adds a newly keyed provider's catalog models to a saved list", async () => {
    await setProviderKey("gemini", "sk-good-gemini-7777");
    await allowProviderModels("google");
    expect((await readModelSettings()).models).toEqual(["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna", "google/gemini-3.8-flash"]);
    await applyModels();
    const configs = fake.state.vks[0]!.provider_configs as Array<{ provider: string; allowed_models: string[] }>;
    expect(configs.find((c) => c.provider === "gemini")?.allowed_models).toEqual(["gemini-3.8-flash"]);
  });

  it("still narrows the keys when strut is down, and says strut was not told", async () => {
    fake.state.down.strut = true;
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5"], defaultModel: "anthropic/claude-opus-5-5", prices: {} });
    const r = await applyModels();
    expect(r.strut).toBe(false);
    expect(r.updated).toBe(3);
    expect(fake.state.deploymentSecrets.get(STRUT_DEFAULT_MODEL)).toBe("openai/gpt-5.6-luna");
  });
});

describe("modelsView", () => {
  it("groups each keyed provider's catalog and typed-in models, marking what is allowed and the default", async () => {
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"], defaultModel: "anthropic/claude-opus-5-5", prices: {} });
    await setProviderKey("openrouter", "sk-good-or-3333");
    const view = await modelsView();
    expect(view.groups?.map((g) => g.provider.id)).toEqual(["anthropic", "openai", "gemini", "openrouter"]);
    const anthropic = view.groups![0]!.models;
    expect(anthropic.map((m) => [m.modelId, m.alias, m.allowed, m.isDefault])).toEqual([
      ["claude-sonnet-5-5", "sonnet", false, false],
      ["claude-opus-5-5", "opus", true, true],
    ]);
    const openrouter = view.groups![3]!.models;
    expect(openrouter.map((m) => [m.name, m.alias, m.allowed])).toEqual([
      ["openrouter/moonshotai/kimi-k3", "kimi", false],
      ["openrouter/deepseek/deepseek-v4", undefined, true],
    ]);
  });

  it("has providers but no groups when strut does not answer", async () => {
    fake.state.down.strut = true;
    const view = await modelsView();
    expect(view.providers).toHaveLength(7);
    expect(view.groups).toBeNull();
  });
});

describe("custom providers", () => {
  type Config = { provider: string; allowed_models: string[] };
  const configsOf = (i: number) => (fake.state.vks[i]!.provider_configs as Config[]).map((c) => [c.provider, c.allowed_models]);

  it("adds Maple in two calls, the provider then its key, at the proxy's private address", async () => {
    const state = await setProviderKey("maple", "sk-good-maple-1111");
    expect(state).toMatchObject({ id: "maple", kind: "known", preview: "sk-****1111", check: { ok: true } });
    expect(fake.state.customProviders.get("maple")).toEqual({ base_url: "http://maple:8080", allow_private_network: true, base_provider_type: "openai" });
    // The fake, like bifrost, drops a key sent with the provider: this one came in the second call.
    expect(fake.state.providerKeys.get("maple")).toMatchObject([{ name: "maple-key-1", value: "sk-good-maple-1111", models: ["*"] }]);
    expect(fake.state.requests).toContain("POST /bifrost/api/providers");
  });

  it("allows Maple's models, gives each person's key the provider, and prices them in the gateway", async () => {
    await allowProviderModels("maple");
    expect((await readModelSettings()).models).toContain("maple/gemma4-31b");
    expect(await applyModels()).toMatchObject({ failed: 0, strut: true, prices: true });
    expect(configsOf(0)).toContainEqual(["maple", ["gemma4-31b", "gpt-oss-120b"]]);
    expect(fake.state.pricing).toEqual({
      "maple/gemma4-31b": { input_per_mtok: 0.8, output_per_mtok: 2 },
      "maple/gpt-oss-120b": { input_per_mtok: 0.3, output_per_mtok: 1.2 },
      "numes/z-ai/glm-5.3": { input_per_mtok: 0, output_per_mtok: 0 },
    });
    expect(JSON.parse(fake.state.deploymentSecrets.get(STRUT_MODELS)!)).toContain("maple/gemma4-31b");
  });

  it("adds an OpenAI-compatible provider under its own name, at its root address", async () => {
    const state = await addOtherProvider("together", "https://api.together.xyz/v1/", "sk-good-together-2222");
    expect(state).toMatchObject({ id: "together", strut: "together", kind: "other", baseUrl: "https://api.together.xyz", check: { ok: true } });
    expect(fake.state.customProviders.get("together")).toEqual({ base_url: "https://api.together.xyz", base_provider_type: "openai" });
    expect((await providerStates()).find((s) => s.id === "together")).toMatchObject({ kind: "other", preview: "sk-****2222" });
    await expect(addOtherProvider("together", "https://x.test", "sk-good")).rejects.toThrow("already has a provider");
  });

  it("refuses a name that is taken or would not start a model name, and takes the provider back out when its key is refused", async () => {
    expect(otherNameProblem("maple")).toContain("taken");
    expect(otherNameProblem("mistral")).toContain("taken");
    expect(otherNameProblem("My Provider")).toContain("lowercase");
    expect(otherNameProblem("acme-ai")).toBeUndefined();
    await expect(addOtherProvider("acme-ai", "https://acme.test", "")).rejects.toThrow("must not be empty");
    expect(fake.state.customProviders.has("acme-ai")).toBe(false);
  });

  it("prices a typed model of an added provider, and lets it on everyone's key", async () => {
    const settings = await readModelSettings();
    await saveModelSettings({
      models: [...settings.models!, "together/llama-4"],
      defaultModel: settings.defaultModel,
      prices: { "together/llama-4": { input: 0.5, output: 1.5 } },
    });
    await applyModels();
    expect(fake.state.pricing).toMatchObject({ "together/llama-4": { input_per_mtok: 0.5, output_per_mtok: 1.5 } });
    expect(configsOf(0)).toContainEqual(["together", ["llama-4"]]);
    const view = await modelsView();
    const together = view.groups!.find((g) => g.provider.id === "together")!;
    expect(together.models).toEqual([{ name: "together/llama-4", modelId: "llama-4", price: { input: 0.5, output: 1.5 }, allowed: true, isDefault: false }]);
    expect(view.groups!.find((g) => g.provider.id === "maple")!.models[0]).toMatchObject({ price: { input: 0.8, output: 2 } });
  });

  it("removes a custom provider whole, and it leaves everyone's key", async () => {
    await removeProviderKey("together");
    expect(fake.state.customProviders.has("together")).toBe(false);
    await applyModels();
    expect(configsOf(0).map(([p]) => p)).not.toContain("together");
    await removeProviderKey("maple");
    expect(fake.state.customProviders.has("maple")).toBe(false);
    expect((await providerStates()).find((s) => s.id === "maple")).toMatchObject({ kind: "known", preview: "" });
  });

  it("says the gateway took no prices when it predates the route", async () => {
    fake.state.pricing = null;
    try {
      expect((await applyModels()).prices).toBe(false);
    } finally {
      fake.state.pricing = {};
    }
  });
});

describe("ensureGatewayLogRetention", () => {
  it("sets 60 days once, sending the rest of the client config back as it was", async () => {
    expect(await ensureGatewayLogRetention()).toBe("set");
    expect(fake.state.clientConfig).toEqual({ log_retention_days: 60, enable_logging: true, disable_content_logging: false, drop_excess_requests: false });
    expect(await ensureGatewayLogRetention()).toBe("kept");
  });
});

describe("providers given at install", () => {
  const give = (v: unknown) => {
    process.env.STADEUM_MODEL_PROVIDERS = JSON.stringify(v);
  };
  const net = (p: string) => fake.state.providerNetwork.get(p)!;
  afterAll(() => {
    delete process.env.STADEUM_MODEL_PROVIDERS;
  });

  it("writes nothing when none is given", async () => {
    delete process.env.STADEUM_MODEL_PROVIDERS;
    expect(await applyGivenProviders()).toBe(0);
  });

  it("writes each one's address and key; the gateway checks the key, and the page shows it as given", async () => {
    give([
      { provider: "openai", key: "sk-good-given-openai", url: "https://models.example.com/openai/" },
      { provider: "openrouter", key: "sk-good-given-openrouter" },
    ]);
    const before = slot("openai");
    expect(await applyGivenProviders()).toBe(2);
    // The address, with the rest of the network settings sent back as they were.
    expect(net("openai")).toEqual({
      default_request_timeout_in_seconds: 30,
      max_retries: 0,
      retry_backoff_initial: 500,
      retry_backoff_max: 5000,
      base_url: "https://models.example.com/openai",
    });
    expect(net("openrouter").base_url).toBeUndefined();
    // The key replaces the env slot in place, as a pasted one does.
    expect(fake.state.providerKeys.get("openai")).toHaveLength(1);
    expect(slot("openai")).toMatchObject({ id: before.id, name: before.name, value: "sk-good-given-openai" });
    const states = await providerStates();
    expect(states.find((s) => s.id === "openai")).toMatchObject({ given: true, baseUrl: "https://models.example.com/openai", check: { ok: true } });
    expect(states.find((s) => s.id === "openrouter")).toMatchObject({ given: true, check: { ok: true } });
    expect(states.find((s) => s.id === "openrouter")!.baseUrl).toBeUndefined();
    expect(states.find((s) => s.id === "gemini")!.given).toBeUndefined();
  });

  it("refuses an admin's change or removal, and still tests the key", async () => {
    await expect(setProviderKey("openai", "sk-good-mine")).rejects.toThrow(GIVEN_REFUSAL);
    await expect(removeProviderKey("openai")).rejects.toThrow(GIVEN_REFUSAL);
    expect(slot("openai").value).toBe("sk-good-given-openai");
    expect(await checkProviderKey("openai")).toMatchObject({ check: { ok: true } });
  });

  it("puts back what the gateway lost, and leaves an address that is already right", async () => {
    const openrouterNet = net("openrouter");
    fake.state.providerNetwork.set("openai", { default_request_timeout_in_seconds: 30 });
    slot("openai").value = { value: "", ref: "env.OPENAI_API_KEY", type: "env" };
    expect(await applyGivenProviders()).toBe(2);
    expect(net("openai")).toEqual({ default_request_timeout_in_seconds: 30, base_url: "https://models.example.com/openai" });
    expect(slot("openai").value).toBe("sk-good-given-openai");
    expect(net("openrouter")).toBe(openrouterNet);
  });

  it("gives an address on the box's network the gateway's leave, and dropping it gives the provider its own back", async () => {
    give([{ provider: "openai", key: "sk-good-given-openai", url: "http://models:8080" }]);
    await applyGivenProviders();
    expect(net("openai")).toMatchObject({ base_url: "http://models:8080", allow_private_network: true });
    give([{ provider: "openai", key: "sk-good-given-openai" }]);
    await applyGivenProviders();
    expect(net("openai").base_url).toBeUndefined();
    expect(net("openai").allow_private_network).toBeUndefined();
  });
});
