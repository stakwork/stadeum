"use client";

import { useActionState } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass, FormNote, Labelled, Submit } from "@/components/form";
import { create, revoke, type CreateState } from "./actions";

export function CreateKeyForm() {
  const [state, action] = useActionState<CreateState, FormData>(create, {});
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col">
          <Labelled id="key-name" label="Name">
            <input id="key-name" name="name" required maxLength={60} placeholder="CI export" className={fieldClass} />
          </Labelled>
        </div>
        <div className="flex flex-[0_1_200px] flex-col">
          <Labelled id="key-scope" label="Scope">
            <select id="key-scope" name="scope" defaultValue="read" className={`${fieldClass} px-3`}>
              <option value="read">Read only</option>
              <option value="read_write">Read and write</option>
            </select>
          </Labelled>
        </div>
        <Submit className={buttonClass.primary} pendingLabel="Creating…">
          Create key
        </Submit>
      </form>
      {state.created && (
        <div role="status" className="rounded-[10px] border border-rule-strong bg-raised p-4">
          <p className="text-[13px] text-ink-2">
            Copy the key for “{state.created.name}” now. It is shown only once; if you lose it, revoke it and make another.
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-[13px] text-ink select-all">{state.created.key}</code>
        </div>
      )}
      <FormNote state={state}>Send it as <code>Authorization: Bearer &lt;key&gt;</code>.</FormNote>
    </div>
  );
}

export function RevokeButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={revoke}
      onSubmit={(e) => {
        if (!window.confirm(`Revoke “${name}”? Anything using it stops working.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Submit className={buttonClass.danger}>Revoke</Submit>
    </form>
  );
}
