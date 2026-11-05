"use server";

import { revalidatePath } from "next/cache";

import { allowProviderModels, applyModels, saveModelSettings } from "@/lib/models/apply";
import { parseModelsForm, splitName } from "@/lib/models/plan";
import { checkProviderKey, isProviderId, providerStates, removeProviderKey, setProviderKey, type ProviderState } from "@/lib/models/providers";
import { PROVIDERS } from "@/lib/mothership/constants";
import { BifrostHttpError } from "@/lib/mothership/http";
import { requireAdmin } from "@/lib/session";

export type Result = { error?: string; ok?: string };

/** The gateway's own words, without the request line our client adds. */
function gatewaySays(err: unknown): string {
  if (err instanceof BifrostHttpError) {
    if (err.status === 0) return "The gateway isn’t answering. Nothing changed.";
    return err.message.replace(/^.*? failed: \d+ /, "");
  }
  return err instanceof Error ? err.message : String(err);
}

/** The provider's reason shows in its row; the message only says what happened. */
const refused = (s: ProviderState) => `${s.label} refused it.`;

/** After a change: each person's key and strut follow. A failure here is logged; the next upkeep pass retries. */
async function carryOut() {
  await applyModels().catch((err) => console.warn(`[models] apply failed: ${err instanceof Error ? err.message : String(err)}`));
  revalidatePath("/models");
}

/** Paste a provider's key: it replaces the provider's key in the gateway. */
export async function saveKey(provider: string, _prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  if (!isProviderId(provider)) return { error: "That is not a provider stadeum offers." };
  const value = String(form.get("key") ?? "").trim();
  if (!value) return { error: "Paste the key first." };
  if (value.length > 1000 || /\s/.test(value)) return { error: "That doesn’t look like a key: it has spaces in it." };
  let state: ProviderState;
  try {
    const had = (await providerStates()).find((p) => p.id === provider)?.preview;
    state = await setProviderKey(provider, value);
    if (!had) await allowProviderModels(state.strut);
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  await carryOut();
  if (state.check?.ok === false) return { error: `Saved, but ${refused(state)}` };
  return { ok: state.check?.ok ? "Saved. The key works." : "Saved." };
}

/** Ask the gateway to check the key again: it lists the provider's models with it. */
export async function testKey(provider: string): Promise<Result> {
  await requireAdmin();
  if (!isProviderId(provider)) return { error: "That is not a provider stadeum offers." };
  try {
    const state = await checkProviderKey(provider);
    revalidatePath("/models");
    if (!state.preview) return { error: "No key is set." };
    if (state.check?.ok) return { ok: "The key works." };
    return { error: state.check ? refused(state) : "The gateway did not say. Try again in a moment." };
  } catch (err) {
    return { error: gatewaySays(err) };
  }
}

/** Remove a provider's key: nobody can use its models until a new one is set. */
export async function removeKey(provider: string): Promise<Result> {
  await requireAdmin();
  if (!isProviderId(provider)) return { error: "That is not a provider stadeum offers." };
  try {
    await removeProviderKey(provider);
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  await carryOut();
  return { ok: "Removed." };
}

/** The models people may use and the default. */
export async function saveModels(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = parseModelsForm({
    ticked: form.getAll("model").map(String),
    other: String(form.get("other") ?? ""),
    default: String(form.get("default") ?? ""),
  });
  if ("error" in parsed) return { error: parsed.error };
  // A model typed in for a provider with no key would vanish from the page.
  const typed = String(form.get("other") ?? "").trim();
  if (typed) {
    const provider = splitName(typed)!.provider;
    const keyed = await providerStates().then((ps) => ps.find((p) => p.strut === provider && p.preview)).catch(() => undefined);
    const label = PROVIDERS.find((p) => p.strut === provider)?.label ?? provider;
    if (!keyed) return { error: `Set ${label}’s key above first, then allow its models.` };
  }
  await saveModelSettings(parsed);
  let result;
  try {
    result = await applyModels();
  } catch (err) {
    revalidatePath("/models");
    return { error: `Saved, but the gateway isn’t answering, so people’s keys are unchanged for now: ${gatewaySays(err)}` };
  }
  revalidatePath("/models");
  const notes = [
    result.failed ? `${result.failed} ${result.failed === 1 ? "person’s key" : "people’s keys"} could not be updated; the next pass retries.` : "",
    result.strut ? "" : "Strut isn’t answering, so Jamie shows the change once it is.",
  ].filter(Boolean);
  return notes.length ? { error: `Saved. ${notes.join(" ")}` } : { ok: "Saved." };
}

