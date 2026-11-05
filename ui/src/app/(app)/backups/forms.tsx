"use client";

import { useActionState, useState } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass, FormNote, Labelled, Submit } from "@/components/form";
import { DESTINATIONS, KINDS, type Kind } from "@/lib/ops/destination";
import { saveBackups, type FormState } from "./actions";

export function DestinationForm({
  kind: savedKind,
  fields,
  savedSecrets,
  enabled,
}: {
  kind: Kind | null;
  fields: Record<string, string>;
  savedSecrets: string[];
  enabled: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveBackups, {});
  const [kind, setKind] = useState<Kind>(savedKind ?? "s3");
  const spec = DESTINATIONS[kind];
  const same = kind === savedKind;

  return (
    <form action={action} className="flex flex-col gap-5 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
      <Labelled id="backup-kind" label="Where" hint={spec.hint}>
        <select id="backup-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={`${fieldClass} max-w-md px-3`}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {DESTINATIONS[k].label}
            </option>
          ))}
        </select>
      </Labelled>

      <div key={kind} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {spec.fields.map((f) => {
          const id = `backup-${f.name}`;
          const saved = f.secret && same && savedSecrets.includes(f.name);
          const common = {
            id,
            name: f.name,
            required: !f.optional && !saved,
            placeholder: saved ? "Saved. Leave blank to keep it" : f.placeholder,
            defaultValue: f.secret || !same ? "" : (fields[f.name] ?? ""),
            autoComplete: "off",
            spellCheck: false,
          };
          return (
            <div key={f.name} className={f.multiline ? "sm:col-span-2" : undefined}>
              <Labelled id={id} label={f.optional ? `${f.label} (optional)` : f.label} hint={f.hint}>
                {f.multiline ? (
                  <textarea {...common} rows={4} className={`${fieldClass} h-auto py-2.5 font-mono text-[13px]`} />
                ) : (
                  <input {...common} type={f.secret ? "password" : "text"} className={fieldClass} />
                )}
              </Labelled>
            </div>
          );
        })}
      </div>

      <label className="flex items-start gap-3 text-[14.5px] text-ink">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1 size-4 accent-[var(--accent)]" />
        <span className="flex flex-col gap-0.5">
          Back up every night in the window
          <span className="text-[13px] text-ink-3">Off: only Back up now takes one.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <Submit className={buttonClass.primary} pendingLabel="Saving…">
          Save
        </Submit>
        <FormNote state={state}>Credentials are kept encrypted, and only ops reads them.</FormNote>
      </div>
    </form>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass.secondary}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        )
      }
    >
      {copied ? "Copied" : "Copy the kit"}
    </button>
  );
}
