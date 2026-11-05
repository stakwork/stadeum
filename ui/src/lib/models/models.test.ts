import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ensureGatewayLogRetention } from "@/lib/mothership/gateway-settings";
import { ensureVirtualKey } from "@/lib/mothership/virtual-key";
import { startFakeStack, type FakeKey, type FakeStack } from "@/test/fake-stack";
import { allowProviderModels, applyModels, modelsView, STRUT_DEFAULT_MODEL, STRUT_MODELS } from "./apply";
import { checkProviderKey, providerSays, providerStates, removeProviderKey, setProviderKey } from "./providers";
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
    expect(states.map((s) => s.id)).toEqual(["anthropic", "openai", "gemini", "xai", "openrouter"]);
    expect(states.every((s) => s.preview === "" && !s.missing)).toBe(true);
  });

  it("replaces the env slot in place, under its name, and the gateway checks the key", async () => {
    const before = slot("anthropic");
    const state = await setProviderKey("anthropic", "sk-good-anthropic-1234");
    expect(state).toMatchObject({ id: "anthropic", strut: "anthropic", preview: "sk-****1234", check: { ok: true } });
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
    await expect(setProviderKey("xai", "sk-good-x")).rejects.toThrow("no xai provider");
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
    expect(r).toEqual({ updated: 0, failed: 0, strut: true });
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
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5", "openai/gpt-5.6-luna"], defaultModel: "openai/gpt-5.6-luna" });
    expect(await applyModels()).toEqual({ updated: 2, failed: 0, strut: true });
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
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5"], defaultModel: "anthropic/claude-opus-5-5" });
    const r = await applyModels();
    expect(r.strut).toBe(false);
    expect(r.updated).toBe(3);
    expect(fake.state.deploymentSecrets.get(STRUT_DEFAULT_MODEL)).toBe("openai/gpt-5.6-luna");
  });
});

describe("modelsView", () => {
  it("groups each keyed provider's catalog and typed-in models, marking what is allowed and the default", async () => {
    await saveModelSettings({ models: ["anthropic/claude-opus-5-5", "openrouter/deepseek/deepseek-v4"], defaultModel: "anthropic/claude-opus-5-5" });
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
    expect(view.providers).toHaveLength(5);
    expect(view.groups).toBeNull();
  });
});

describe("ensureGatewayLogRetention", () => {
  it("sets 60 days once, sending the rest of the client config back as it was", async () => {
    expect(await ensureGatewayLogRetention()).toBe("set");
    expect(fake.state.clientConfig).toEqual({ log_retention_days: 60, enable_logging: true, disable_content_logging: false, drop_excess_requests: false });
    expect(await ensureGatewayLogRetention()).toBe("kept");
  });
});
