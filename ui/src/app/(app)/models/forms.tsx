"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass } from "@/components/button";
import { Dot } from "@/components/state";
import type { ModelRow } from "@/lib/models/apply";
import type { ProviderState } from "@/lib/models/providers";
import { addProvider, removeKey, saveKey, saveModels, testKey, type Result } from "./actions";

const small =
  "inline-flex h-8 items-center justify-center rounded-lg border border-rule-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink-3 disabled:pointer-events-none disabled:opacity-50";
const field =
  "h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3.5 font-mono text-[14px] text-ink placeholder:font-sans placeholder:text-ink-3 focus:border-ink-3 focus:outline-none";

function Said({ result }: { result: Result }) {
  if (!result.error && !result.ok) return null;
  return (
    <p aria-live="polite" className={`text-[13px] ${result.error ? "text-warn" : "text-ok"}`}>
      {result.error ?? result.ok}
    </p>
  );
}

function Submit({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {children}
    </button>
  );
}

function KeyState({ p }: { p: ProviderState }) {
  if (p.missing) return <Dot tone="muted" label="Not in this gateway" />;
  if (!p.preview) return <Dot tone="muted" label="No key" />;
  if (p.check?.ok) return <Dot tone="ok" label="Working" />;
  if (p.check) return <Dot tone="attention" label="Refused" />;
  return <Dot tone="pending" label="Not checked yet" />;
}

/**
 * One provider: its key as the gateway shows it (masked), whether the key
 * works, and Set, Test and Remove. The key goes from this form to the
 * gateway and nowhere else. A provider the box's host gives has Test alone.
 */
function ProviderRow({ p }: { p: ProviderState }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<Result>({});
  const [pending, start] = useTransition();
  const [, action] = useActionState<Result, FormData>(async (prev, form) => {
    const r = await saveKey(p.id, prev, form);
    if (!r.error || r.error.startsWith("Saved")) setEditing(false);
    setSaid(r);
    return r;
  }, {});
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setSaid(await fn());
      setConfirming(false);
    });

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium text-ink">{p.label}</span>
          {p.note && <span className="text-[13px] text-ink-2">{p.note}</span>}
          {p.given && <span className="text-[13px] text-ink-2">Given by this box&rsquo;s host.</span>}
          {(p.kind === "other" || p.given) && p.baseUrl && <span className="font-mono text-[12.5px] text-ink-3">{p.baseUrl}</span>}
          <span className="font-mono text-[12.5px] text-ink-3">{p.preview || "—"}</span>
        </div>
        <span className="w-[150px] text-[13px]">
          <KeyState p={p} />
        </span>
        {!p.missing && (
          <div className="flex flex-wrap gap-2 md:w-[262px] md:justify-end">
            {!p.given && (
              <button type="button" className={small} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
                {p.preview ? "Replace key" : "Set key"}
              </button>
            )}
            {p.given && p.preview && (
              <button type="button" className={small} disabled={pending} onClick={() => run(() => testKey(p.id))}>
                Test
              </button>
            )}
            {!p.given && p.preview && (
              <>
                <button type="button" className={small} disabled={pending} onClick={() => run(() => testKey(p.id))}>
                  Test
                </button>
                {confirming ? (
                  <button type="button" className={`${small} text-danger`} disabled={pending} onClick={() => run(() => removeKey(p.id))}>
                    {p.kind === "builtin" ? <>Remove {p.label}&rsquo;s key?</> : <>Remove {p.label}?</>}
                  </button>
                ) : (
                  <button type="button" className={small} onClick={() => setConfirming(true)}>
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {p.check && !p.check.ok && p.check.detail && <p className="text-[13px] text-ink-2">{p.check.detail}</p>}
      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
            <label htmlFor={`key-${p.id}`} className="text-[13px] font-medium text-ink">
              {p.label} API key
            </label>
            <input
              id={`key-${p.id}`}
              name="key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              placeholder="Paste the key"
              className={field}
            />
          </div>
          <Submit className={`${buttonClass.primary} h-10`}>Save key</Submit>
          <button type="button" className={`${buttonClass.quiet} h-10`} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      <Said result={said} />
    </li>
  );
}

export function Providers({ providers }: { providers: ProviderState[] }) {
  return (
    <ul className="divide-y divide-rule-soft overflow-hidden rounded-xl border border-rule bg-surface">
      {providers.map((p) => (
        <ProviderRow key={p.id} p={p} />
      ))}
      {/* A new list (a provider added or removed) starts the form afresh: the new row says how its key fared. */}
      <AddProvider key={providers.map((p) => p.id).join(",")} />
    </ul>
  );
}

/**
 * Any provider with an OpenAI-compatible API: its name (which starts every
 * one of its models' names), its address and its key. The gateway holds it
 * as a custom provider.
 */
function AddProvider() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<Result, FormData>(async (prev, form) => {
    const r = await addProvider(prev, form);
    if (!r.error || r.error.startsWith("Added")) setOpen(false);
    return r;
  }, {});
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium text-ink">Another provider</span>
          <span className="text-[13px] text-ink-2">Any provider with an OpenAI-compatible API.</span>
        </div>
        <button type="button" className={small} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Add a provider
        </button>
      </div>
      {open && (
        <form action={action} className="grid gap-3 md:grid-cols-[160px_1fr]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="provider-name" className="text-[13px] font-medium text-ink">
              Name
            </label>
            <input id="provider-name" name="name" required autoComplete="off" spellCheck={false} placeholder="together" className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="provider-url" className="text-[13px] font-medium text-ink">
              Address
            </label>
            <input
              id="provider-url"
              name="url"
              type="url"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.together.xyz/v1"
              className={field}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label htmlFor="provider-key" className="text-[13px] font-medium text-ink">
              API key
            </label>
            <input id="provider-key" name="key" type="password" required autoComplete="off" spellCheck={false} placeholder="Paste the key" className={field} />
          </div>
          <div className="flex flex-wrap gap-3 md:col-span-2">
            <Submit className={`${buttonClass.primary} h-10`}>Add provider</Submit>
            <button type="button" className={`${buttonClass.quiet} h-10`} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <Said result={state} />
    </li>
  );
}

const dollars = (n: number) => n.toFixed(2);

function PriceNote({ price }: { price?: { input: number; output: number } }) {
  if (!price) return null;
  if (price.input === 0 && price.output === 0) return <span className="text-[12.5px] text-ok">Free</span>;
  return (
    <span className="text-[12.5px] text-ink-3">
      ${dollars(price.input)} in · ${dollars(price.output)} out per million tokens
    </span>
  );
}

/**
 * Which models people may pick, and the one everyone gets unless they
 * pick. Saving changes every person's key in the gateway and what Jamie
 * offers.
 */
export function ModelsForm({ groups }: { groups: Array<{ label: string; prefix: string; models: ModelRow[] }> }) {
  const [state, action] = useActionState<Result, FormData>(saveModels, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-xl border border-rule bg-surface">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th scope="col" className="px-5 py-3 font-medium">
                Model
              </th>
              <th scope="col" className="w-[96px] px-5 py-3 text-center font-medium">
                Allowed
              </th>
              <th scope="col" className="w-[96px] px-5 py-3 text-center font-medium">
                Default
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.label}>
              <tr className="border-t border-rule-soft bg-raised/40">
                <th scope="rowgroup" colSpan={3} className="px-5 py-2 text-left text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
                  {g.label}
                </th>
              </tr>
              {g.models.length === 0 && (
                <tr className="border-t border-rule-soft">
                  <td colSpan={3} className="px-5 py-3 text-[13px] text-ink-3">
                    None yet. Allow one below, as {g.prefix}/&lt;model id&gt;, with its price.
                  </td>
                </tr>
              )}
              {g.models.map((m) => (
                <tr key={m.name} className="border-t border-rule-soft">
                  <td className="px-5 py-3">
                    <label htmlFor={`allow-${m.name}`} className="flex flex-col gap-0.5">
                      <span className="font-mono text-[13.5px] text-ink">{m.modelId}</span>
                      {m.alias && <span className="text-[12.5px] text-ink-3">“{m.alias}” for short</span>}
                      <PriceNote price={m.price} />
                    </label>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <input
                      id={`allow-${m.name}`}
                      type="checkbox"
                      name="model"
                      value={m.name}
                      defaultChecked={m.allowed}
                      className="size-4 accent-accent"
                    />
                  </td>
                  <td className="px-5 py-3 text-center">
                    <input
                      type="radio"
                      name="default"
                      value={m.name}
                      defaultChecked={m.isDefault}
                      aria-label={`${m.modelId} is the default`}
                      className="size-4 accent-accent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <label htmlFor="other-model" className="text-[13px] font-medium text-ink">
            Allow another model
          </label>
          <input
            id="other-model"
            name="other"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="provider/id, e.g. openrouter/deepseek/deepseek-v4"
            className={field}
          />
        </div>
        <div className="flex w-[118px] flex-col gap-1.5">
          <label htmlFor="other-input" className="text-[13px] font-medium text-ink">
            $ in / M
          </label>
          <input id="other-input" name="otherInput" inputMode="decimal" autoComplete="off" placeholder="optional" className={field} />
        </div>
        <div className="flex w-[118px] flex-col gap-1.5">
          <label htmlFor="other-output" className="text-[13px] font-medium text-ink">
            $ out / M
          </label>
          <input id="other-output" name="otherOutput" inputMode="decimal" autoComplete="off" placeholder="optional" className={field} />
        </div>
        <Submit className={`${buttonClass.primary} h-10`}>Save</Submit>
      </div>
      <p className="text-[13px] text-ink-3">
        A price is per million tokens, and only needed for a model the gateway cannot price itself (an added provider&rsquo;s).
        Without one, its calls count as $0 against people&rsquo;s spending caps.
      </p>
      <Said result={state} />
    </form>
  );
}
