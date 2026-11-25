import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { isApiKeyScope, listApiKeys, scopeLabel } from "@/lib/api-keys";
import { absoluteTime, relativeTime } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { CreateKeyForm, RevokeButton } from "./forms";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

const td = "px-5 py-3.5";

export default async function ApiKeysPage() {
  await requireAdmin();
  const keys = await listApiKeys();
  return (
    <>
      <PageHeader title="API keys" />
      <CreateKeyForm />
      <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th scope="col" className="px-5 py-3 font-medium">Key</th>
              <th scope="col" className="px-5 py-3 font-medium">Scope</th>
              <th scope="col" className="px-5 py-3 font-medium">Created</th>
              <th scope="col" className="px-5 py-3 font-medium">Last used</th>
              <th scope="col" className="w-24 px-5 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-rule-soft">
                <td className={td}>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{k.name}</span>
                    <span className="text-[13px] text-ink-3">{k.prefix}…</span>
                  </div>
                </td>
                <td className={td}>{isApiKeyScope(k.scope) ? scopeLabel[k.scope] : k.scope}</td>
                <td className={`${td} text-ink-3`}>
                  <time dateTime={k.createdAt.toISOString()} title={absoluteTime(k.createdAt)}>{relativeTime(k.createdAt)}</time>
                  <span className="block text-[13px]">by {k.createdBy.name || k.createdBy.email}</span>
                </td>
                <td className={`${td} text-ink-3`}>
                  {k.lastUsedAt ? <time dateTime={k.lastUsedAt.toISOString()} title={absoluteTime(k.lastUsedAt)}>{relativeTime(k.lastUsedAt)}</time> : "Never"}
                </td>
                <td className="px-3 py-2"><RevokeButton id={k.id} name={k.name} /></td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr className="border-t border-rule-soft">
                <td colSpan={5} className={`${td} text-ink-3`}>No keys yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
