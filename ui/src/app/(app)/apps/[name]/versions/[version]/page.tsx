import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { versionsHref } from "@/lib/app-admin";
import { isOpened, listApps as launcherApps } from "@/lib/apps";
import { requireAdmin } from "@/lib/session";
import { getAppVersions, listApps } from "@/lib/strut/client";
import { AppFrame, CannotOpen } from "../../../app-frame";
import { appName } from "../../../app-name";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string; version: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await params;
  const name = appName(p.name);
  return { title: `${(await launcherApps())?.find((a) => a.name === name)?.title ?? name} ${appName(p.version)}` };
}

/**
 * One version of an app, framed for this admin alone: strut's app key
 * `<name>@vN` (`specs/API.md` §14.3) shows that version in place of the
 * live one. Nobody else's app changes.
 */
export default async function ViewVersionPage({ params }: Params) {
  await requireAdmin();
  const p = await params;
  const name = appName(p.name);
  const version = appName(p.version);
  if (!isOpened(name) || !/^v\d+$/.test(version)) notFound();

  const found = await Promise.all([listApps(), getAppVersions(name)]).catch(() => null);
  if (!found) return <CannotOpen title={`${name} ${version}`} />;
  const [apps, versions] = found;
  const app = apps.find((a) => a.name === name);
  if (!app || !versions.versions[version]) notFound();

  return (
    <>
      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule bg-raised px-4 py-2 text-[13px] text-ink-2 md:px-6">
        <span>
          Viewing <strong className="font-medium text-ink">{version}</strong> of {app.title}, for you alone.{" "}
          {version === versions.active ? "It is what everyone gets." : `Everyone else gets ${versions.active}.`}
        </span>
        <Link href={versionsHref(name)} className="font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          Back to versions
        </Link>
      </p>
      <AppFrame app={{ name: `${name}@${version}`, title: `${app.title} ${version}` }} />
    </>
  );
}
