"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass } from "@/components/button";
import { Dot } from "@/components/state";
import type { ModelRow } from "@/lib/models/apply";
import type { ProviderState } from "@/lib/models/providers";
import { removeKey, saveKey, saveModels, testKey, type Result } from "./actions";

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
 * gateway and nowhere else.
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
          <span className="font-mono text-[12.5px] text-ink-3">{p.preview || "—"}</span>
        </div>
        <span className="w-[150px] text-[13px]">
          <KeyState p={p} />
        </span>
        {!p.missing && (
          <div className="flex flex-wrap gap-2 md:w-[262px] md:justify-end">
            <button type="button" className={small} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
              {p.preview ? "Replace key" : "Set key"}
            </button>
            {p.preview && (
              <>
                <button type="button" className={small} disabled={pending} onClick={() => run(() => testKey(p.id))}>
                  Test
                </button>
                {confirming ? (
                  <button type="button" className={`${small} text-danger`} disabled={pending} onClick={() => run(() => removeKey(p.id))}>
                    Remove {p.label}&rsquo;s key?
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
    </ul>
  );
}

/**
 * Which models people may pick, and the one everyone gets unless they
 * pick. Saving changes every person's key in the gateway and what Jamie
 * offers.
 */
export function ModelsForm({ groups }: { groups: Array<{ label: string; models: ModelRow[] }> }) {
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
              {g.models.map((m) => (
                <tr key={m.name} className="border-t border-rule-soft">
                  <td className="px-5 py-3">
                    <label htmlFor={`allow-${m.name}`} className="flex flex-col gap-0.5">
                      <span className="font-mono text-[13.5px] text-ink">{m.modelId}</span>
                      {m.alias && <span className="text-[12.5px] text-ink-3">“{m.alias}” for short</span>}
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
        <Submit className={`${buttonClass.primary} h-10`}>Save</Submit>
      </div>
      <Said result={state} />
    </form>
  );
}
