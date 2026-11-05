import { describeDelegation } from "@/components/delegation";
import { Rail } from "@/components/rail";
import { listApps } from "@/lib/apps";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [apps, mothership] = await Promise.all([
    listApps(),
    db.mothershipUser.findUnique({ where: { userId: user.id } }),
  ]);
  const access = describeDelegation(mothership);

  return (
    <div className="min-h-dvh md:flex">
      <Rail
        orgName={env.orgName()}
        apps={apps.map((a) => ({ id: a.id, name: a.name, entry: a.entry }))}
        admin={isAdmin(user.role)}
        person={{ name: user.name || user.email, tone: access.tone, state: access.rail }}
      />
      <div className="min-w-0 flex-1">
        {env.devLogin() && (
          <p className="bg-warn-soft px-4 py-1.5 text-center text-[12.5px] text-warn">
            Development sign-in is on
          </p>
        )}
        <main className="mx-auto flex w-full max-w-[1048px] flex-col gap-10 px-4 pt-6 pb-20 md:gap-11 md:px-14 md:pt-12">
          {children}
        </main>
      </div>
    </div>
  );
}
