import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startFakeStack, type FakeStack } from "@/test/fake-stack";
import { BifrostClient } from "./bifrost-client";
import { BifrostPluginClient } from "./bifrost-plugin-client";
import { BifrostHttpError } from "./http";
import { desiredProviders, ensureCustomer, ensureVk } from "./virtual-key";

let fake: FakeStack;
let gov: BifrostClient;
let plugin: BifrostPluginClient;

beforeAll(async () => {
  fake = await startFakeStack({ providers: ["anthropic", "openai"] });
  gov = new BifrostClient({ baseUrl: fake.bifrostUrl, adminUser: fake.adminUser, adminPassword: fake.adminPass });
  plugin = new BifrostPluginClient({ baseUrl: fake.bifrostUrl, provisioningToken: fake.token });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.state.customers.length = 0;
  fake.state.vks.length = 0;
  fake.state.trust.clear();
});

describe("BifrostClient", () => {
  it("sends Basic admin auth", async () => {
    const bad = new BifrostClient({ baseUrl: fake.bifrostUrl, adminUser: "admin", adminPassword: "wrong" });
    await expect(bad.listProviders()).rejects.toMatchObject({ status: 401 });
    await expect(gov.listProviders()).resolves.toMatchObject({ total: 2 });
  });

  it("narrows providers to what the gateway has configured", async () => {
    expect(await desiredProviders(gov)).toEqual(["anthropic", "openai"]);
  });

  it("ensureCustomer finds by exact name, not substring, and is idempotent", async () => {
    await gov.createCustomer({ name: "ada-0f3c-old" });
    const a = await ensureCustomer(gov, "ada-0f3c");
    const b = await ensureCustomer(gov, "ada-0f3c");
    expect(a.id).toBe(b.id);
    expect(fake.state.customers.filter((c) => c.name === "ada-0f3c")).toHaveLength(1);
  });

  it("ensureVk creates with key_ids [*] for each provider and reuses it", async () => {
    const c = await ensureCustomer(gov, "ada-0f3c");
    const first = await ensureVk(gov, "ada-0f3c", c.id, ["anthropic", "openai"]);
    expect(first.created).toBe(true);
    expect(first.virtualKey.value).toMatch(/^sk-bf-/);
    const again = await ensureVk(gov, "ada-0f3c", c.id, ["anthropic", "openai"]);
    expect(again.created).toBe(false);
    expect(again.virtualKey.id).toBe(first.virtualKey.id);
  });

  it("surfaces gateway errors as BifrostHttpError with status", async () => {
    const err = await gov.createVirtualKey({ name: "x", customer_id: "c", provider_configs: [{ provider: "xai", allowed_models: ["*"], key_ids: ["*"] }] }).catch((e) => e);
    expect(err).toBeInstanceOf(BifrostHttpError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("not configured");
  });
});

describe("BifrostPluginClient", () => {
  it("sends the provisioning token as Bearer", async () => {
    const bad = new BifrostPluginClient({ baseUrl: fake.bifrostUrl, provisioningToken: "nope" });
    await expect(bad.getTrustStatus()).rejects.toMatchObject({ status: 401 });
  });

  it("reads admin credentials", async () => {
    expect(await plugin.getAdminCredentials()).toEqual({ admin_username: fake.adminUser, admin_password: fake.adminPass });
  });

  it("registers an org and reads it back; unknown org is null", async () => {
    expect(await plugin.getTrustOrg("stadeum_x")).toBeNull();
    const pubkey = "02" + "a".repeat(64);
    await plugin.upsertTrust({ org_id: "stadeum_x", pubkey, issuer_url: "http://ui", revocation_poll_seconds: 60 });
    expect((await plugin.getTrustStatus()).orgs).toEqual(["stadeum_x"]);
    expect(await plugin.getTrustOrg("stadeum_x")).toMatchObject({ pubkey });
  });

  it("sets realm_id", async () => {
    await plugin.setRealmId("acme");
    expect((await plugin.getTrustStatus()).realm_id).toBe("acme");
  });

  it("reports a network failure as status 0", async () => {
    const dead = new BifrostPluginClient({ baseUrl: "http://127.0.0.1:1", provisioningToken: "x", timeoutMs: 500 });
    await expect(dead.getTrustStatus()).rejects.toMatchObject({ status: 0 });
  });
});
