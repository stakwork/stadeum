"use server";

import { revalidatePath } from "next/cache";

import { allowProviderModels, applyModels, readModelSettings, saveModelSettings, type ApplyResult } from "@/lib/models/apply";
import { parseModelsForm, splitName } from "@/lib/models/plan";
import {
  addOtherProvider,
  checkProviderKey,
  providerStates,
  removeProviderKey,
  setProviderKey,
  type ProviderState,
} from "@/lib/models/providers";
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

/** After a change: each person's key, strut and the gateway's prices follow. A failure here is logged; the next upkeep pass retries. */
async function carryOut() {
  await applyModels().catch((err) => console.warn(`[models] apply failed: ${err instanceof Error ? err.message : String(err)}`));
  revalidatePath("/models");
}

const keyProblem = (value: string) =>
  !value ? "Paste the key first." : value.length > 1000 || /\s/.test(value) ? "That doesn’t look like a key: it has spaces in it." : undefined;

function saved(state: ProviderState): Result {
  if (state.check?.ok === false) return { error: `Saved, but ${refused(state)}` };
  return { ok: state.check?.ok ? "Saved. The key works." : "Saved." };
}

/** Paste a provider's key: it replaces the provider's key in the gateway (adding Maple or Numes there first). */
export async function saveKey(provider: string, _prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const value = String(form.get("key") ?? "").trim();
  const problem = keyProblem(value);
  if (problem) return { error: problem };
  let state: ProviderState;
  try {
    const had = (await providerStates()).find((p) => p.id === provider)?.preview;
    state = await setProviderKey(provider, value);
    if (!had) await allowProviderModels(state.strut);
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  await carryOut();
  return saved(state);
}

/** Add an OpenAI-compatible provider: its name (which starts its models' names), its address and its key. */
export async function addProvider(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim().toLowerCase();
  const url = String(form.get("url") ?? "").trim();
  const value = String(form.get("key") ?? "").trim();
  if (!/^https?:\/\/[^\s/]+/.test(url)) return { error: "Give its address, starting https://, as its documentation says for OpenAI clients." };
  const problem = keyProblem(value);
  if (problem) return { error: problem };
  let state: ProviderState;
  try {
    state = await addOtherProvider(name, url, value);
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  await carryOut();
  if (state.check?.ok === false) return { error: `Added, but ${refused(state)}` };
  return { ok: `Added. Allow its models below, as ${name}/<model id>.` };
}

/** Ask the gateway to check the key again: it lists the provider's models with it. */
export async function testKey(provider: string): Promise<Result> {
  await requireAdmin();
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

/** Remove a provider's key (a custom provider goes whole): nobody can use its models until a new one is set. */
export async function removeKey(provider: string): Promise<Result> {
  await requireAdmin();
  try {
    await removeProviderKey(provider);
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  await carryOut();
  return { ok: "Removed." };
}

const applyNotes = (r: ApplyResult, priced: boolean) =>
  [
    r.failed ? `${r.failed} ${r.failed === 1 ? "person’s key" : "people’s keys"} could not be updated; the next pass retries.` : "",
    r.strut ? "" : "Strut isn’t answering, so Jamie shows the change once it is.",
    r.prices || !priced ? "" : "The gateway took no prices (it needs v0.4.398 or later): its calls to Maple, Numes and added providers count as $0 for now.",
  ].filter(Boolean);

/** The models people may use, the default, and a typed-in model with its price. */
export async function saveModels(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  let states: ProviderState[];
  try {
    states = await providerStates();
  } catch (err) {
    return { error: gatewaySays(err) };
  }
  const settings = await readModelSettings();
  const parsed = parseModelsForm(
    {
      ticked: form.getAll("model").map(String),
      other: String(form.get("other") ?? ""),
      default: String(form.get("default") ?? ""),
      otherInput: String(form.get("otherInput") ?? ""),
      otherOutput: String(form.get("otherOutput") ?? ""),
    },
    new Set(states.map((s) => s.strut)),
    settings.prices,
  );
  if ("error" in parsed) return { error: parsed.error };
  // A model typed in for a provider with no key would vanish from the page.
  const typed = String(form.get("other") ?? "").trim();
  if (typed) {
    const provider = states.find((s) => s.strut === splitName(typed)!.provider)!;
    if (!provider.preview) return { error: `Set ${provider.label}’s key above first, then allow its models.` };
  }
  await saveModelSettings(parsed);
  let result: ApplyResult;
  try {
    result = await applyModels();
  } catch (err) {
    revalidatePath("/models");
    return { error: `Saved, but the gateway isn’t answering, so people’s keys are unchanged for now: ${gatewaySays(err)}` };
  }
  revalidatePath("/models");
  const priced = states.some((s) => s.kind !== "builtin" && s.preview);
  const notes = applyNotes(result, priced);
  return notes.length ? { error: `Saved. ${notes.join(" ")}` } : { ok: "Saved." };
}
