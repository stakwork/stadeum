import { Suspense } from "react";

import { CallProvider } from "@/components/call";
import { describeDelegation } from "@/components/delegation";
import { Rail } from "@/components/rail";
import { listApps } from "@/lib/apps";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdmin, isRole, roleLabel } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { HomeFrame } from "./apps/home-frame";
import { strutOrigin } from "./apps/app-frame";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [apps, mothership] = await Promise.all([
    listApps(),
    db.mothershipUser.findUnique({ where: { userId: user.id } }),
  ]);
  const access = describeDelegation(mothership);
  const home = apps?.find((a) => a.assistant);

  // The call and the assistant's frame live here, above every page, so they keep going as the person moves between them.
  return (
    <CallProvider assistant={home?.title ?? "Jamie"}>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <Rail
          orgName={env.orgName()}
          home={home?.title ?? "Home"}
          apps={(apps ?? []).filter((a) => !a.assistant).map((a) => ({ title: a.title, href: a.href }))}
          admin={isAdmin(user.role)}
          person={{
            name: user.name || user.email,
            email: user.email,
            role: isRole(user.role) ? roleLabel[user.role] : user.role,
            tone: access.tone,
            state: access.label,
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {env.devLogin() && (
            <p className="bg-warn-soft px-4 py-1.5 text-center text-[12.5px] text-warn">Development sign-in is on</p>
          )}
          {/* A framed app (`data-bleed`) fills the page: no width cap, no padding. */}
          <main className="mx-auto flex w-full max-w-[1048px] flex-1 flex-col gap-10 px-4 pt-6 pb-20 md:gap-11 md:px-14 md:pt-12 has-[>[data-bleed]]:max-w-none has-[>[data-bleed]]:gap-0 has-[>[data-bleed]]:p-0">
            {children}
            {home && (
              <Suspense>
                <HomeFrame app={home} origin={strutOrigin()} />
              </Suspense>
            )}
          </main>
        </div>
      </div>
    </CallProvider>
  );
}
