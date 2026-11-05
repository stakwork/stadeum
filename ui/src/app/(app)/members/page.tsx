import type { Metadata } from "next";

import { Dot } from "@/components/state";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { absoluteTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { isRole, roleLabel, type Role } from "@/lib/roles";
import { requireAdmin } from "@/lib/session";
import { InviteForm, RowMenu } from "./forms";

export const metadata: Metadata = { title: "Members" };
export const dynamic = "force-dynamic";

function joined(d: Date, now = new Date()) {
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

const td = "px-5 py-3.5";

export default async function MembersPage() {
  const me = await requireAdmin();
  const [users, invites] = await Promise.all([
    db.user.findMany({ include: { mothership: true }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { acceptedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);
  const admins = users.filter((u) => u.role === "admin").length;
  const domains = env.allowedDomains();

  return (
    <>
      <PageHeader title="Members" />

      <InviteForm
        placeholderDomain={domains[0] ?? "example.com"}
        domainNote={
          domains.length > 0 && (
            <>
              Anyone at{" "}
              {domains.map((d, i) => (
                <span key={d}>
                  {i > 0 && ", "}
                  <strong className="font-medium text-ink">{d}</strong>
                </span>
              ))}{" "}
              can also sign in as a member.
            </>
          )
        }
      />

      <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th scope="col" className="px-5 py-3 font-medium">
                Person
              </th>
              <th scope="col" className="w-[130px] px-5 py-3 font-medium">
                Role
              </th>
              <th scope="col" className="w-[150px] px-5 py-3 font-medium">
                Can run apps
              </th>
              <th scope="col" className="w-[110px] px-5 py-3 text-right font-medium">
                Joined
              </th>
              <th scope="col" className="w-14 px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const status = u.mothership?.delegationStatus;
              const ready = status === "fresh" || status === "pushed";
              // You can't change yourself, and the last admin stays (lib/members.ts enforces both).
              const editable = u.id !== me.id && isRole(u.role) && !(u.role === "admin" && admins <= 1);
              const name = u.name || u.email;
              return (
                <tr key={u.id} className="border-t border-rule-soft">
                  <td className={td}>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">
                        {name}
                        {u.id === me.id && <span className="ml-2 text-[12px] font-normal text-ink-3">you</span>}
                      </span>
                      {u.name && <span className="text-[13px] text-ink-3">{u.email}</span>}
                    </div>
                  </td>
                  <td className={td}>{isRole(u.role) ? roleLabel[u.role] : u.role}</td>
                  <td className={`${td} text-[13px]`}>
                    {ready ? (
                      <Dot tone="ok" label="Ready" />
                    ) : !status ? (
                      <Dot tone="pending" label="Setting up" />
                    ) : (
                      <Dot tone="attention" label="Not ready" />
                    )}
                  </td>
                  <td className={`${td} tabular text-right text-ink-3`}>
                    <time dateTime={u.createdAt.toISOString()} title={absoluteTime(u.createdAt)}>
                      {joined(u.createdAt)}
                    </time>
                  </td>
                  <td className="px-3 py-2">
                    {editable && <RowMenu kind="member" id={u.id} name={name} role={u.role as Role} />}
                  </td>
                </tr>
              );
            })}
            {invites.map((i) => (
              <tr key={i.id} className="border-t border-rule-soft text-ink-3">
                <td className={td}>
                  <div className="flex flex-col gap-0.5">
                    <span>{i.email}</span>
                    <span className="text-[13px]">Invited, not signed in yet</span>
                  </div>
                </td>
                <td className={td}>{isRole(i.role) ? roleLabel[i.role] : i.role}</td>
                <td className={`${td} text-[13px]`}>—</td>
                <td className={`${td} text-right`}>—</td>
                <td className="px-3 py-2">
                  <RowMenu kind="invite" id={i.id} email={i.email} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
