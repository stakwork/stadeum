import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, SectionLabel } from "@/components/page-header";
import { managedApp, versionsHref } from "@/lib/app-admin";
import {
  STATE_LABEL,
  appVersionRows,
  followNote,
  holdNote,
  liveLabel,
  liveRelease,
  makeLiveNote,
  pinNote,
  restoreNote,
} from "@/lib/app-versions";
import { listApps } from "@/lib/apps";
import { db } from "@/lib/db";
import { absoluteTime, relativeTime } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { appName } from "../../app-name";
import { LiveChange, PinToggle } from "../../manage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const name = appName((await params).name);
  return { title: `${(await listApps())?.find((a) => a.name === name)?.title ?? name} versions` };
}

const td = "px-5 py-3";

/**
 * One app's versions, newest first, for an admin: what is live, and how
 * to change it. Every change asks first and says what everyone will get.
 */
export default async function AppVersionsPage({ params }: Params) {
  await requireAdmin();
  const name = appName((await params).name);
  const found = await managedApp(name).catch((err: unknown) => {
    console.warn(`[apps] versions of ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  });
  if (found === null) notFound();
  if (!found) {
    return (
      <>
        <PageHeader title={name} />
        <p className="rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2">
          Strut isn&rsquo;t answering, so the versions can&rsquo;t be read right now.
        </p>
      </>
    );
  }

  const { app, versions, usage } = found;
  const rows = appVersionRows(versions);
  const release = liveRelease(versions);
  const by = release?.by ? await db.user.findUnique({ where: { actor: release.by } }) : null;
  const published = versions.versions[app.active]?.createdAt;

  return (
    <>
      <PageHeader title={app.title} lede={<span className="font-mono text-[13.5px] text-ink-3">{app.name}</span>}>
        {!app.seeded && <PinToggle name={app.name} pinned={app.pinned} note={pinNote(app.pinned, app.active, app.live)} />}
      </PageHeader>

      <section aria-labelledby="live" className="flex flex-col gap-3">
        <SectionLabel id="live">What&rsquo;s live</SectionLabel>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-rule bg-surface px-5 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-medium text-ink">{app.seeded ? `Seeded by strut, ${app.active}` : liveLabel(app.active, app.live)}</span>
            <span className="text-[13px] text-ink-3">
              {app.seeded
                ? "Seeded by strut: every start makes its committed version live, so it cannot be held."
                : release
                  ? `Live since ${relativeTime(release.createdAt)}${by ? `, by ${by.name || by.email}` : ""}`
                  : `${app.active}${published ? `, published ${relativeTime(published)}` : ""}`}
            </span>
          </div>
          {!app.seeded &&
            (app.held ? (
              <LiveChange name={app.name} label="Follow latest again" note={followNote(versions)} confirmLabel="Go live with every publish" target={{ version: "latest" }} />
            ) : (
              <LiveChange name={app.name} label={`Hold at ${app.active}`} note={holdNote(app.active)} confirmLabel={`Hold at ${app.active}`} target={{ version: app.active }} />
            ))}
        </div>
      </section>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <SectionLabel id="versions">Versions</SectionLabel>
        <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.version} className={i ? "border-t border-rule-soft" : ""}>
                  <td className={`${td} w-[90px] font-medium text-ink`}>{row.version}</td>
                  <td className={`${td} w-[110px] text-[13px]`}>
                    {row.state === "live" ? (
                      <span className="text-ok">{STATE_LABEL.live}</span>
                    ) : (
                      <span className="text-ink-3">{STATE_LABEL[row.state]}</span>
                    )}
                  </td>
                  <td className={`${td} text-[13px] text-ink-3`}>
                    <time dateTime={row.createdAt} title={absoluteTime(row.createdAt)}>
                      {relativeTime(row.createdAt)}
                    </time>
                  </td>
                  <td className="px-5 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        href={versionsHref(app.name, row.version)}
                        className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-raised hover:text-ink"
                      >
                        View
                      </Link>
                      {!app.seeded &&
                        row.state !== "live" &&
                        (row.state === "was-live" && row.release ? (
                          <LiveChange
                            name={app.name}
                            label="Restore"
                            note={restoreNote(row.version)}
                            confirmLabel={`Restore ${row.version}`}
                            target={{ release: row.release }}
                            restores={row.version}
                          />
                        ) : (
                          <LiveChange
                            name={app.name}
                            label="Make live"
                            note={makeLiveNote(row.version, app.live)}
                            confirmLabel={`Make ${row.version} live`}
                            target={{ version: row.version }}
                          />
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {usage.length > 0 && (
        <section aria-labelledby="warnings" className="flex flex-col gap-3">
          <SectionLabel id="warnings">Usage warnings, last day</SectionLabel>
          <ul className="flex flex-col gap-2">
            {usage.map((w, i) => (
              <li key={i} className="flex flex-col gap-1.5 rounded-xl border border-rule bg-surface px-5 py-4">
                <span className="text-[14px] text-ink">{w.message}</span>
                <span className="text-[13px] text-ink-2">{w.fix}</span>
                <span className="text-[12.5px] text-ink-3">
                  {w.version} · {w.times === 1 ? "once" : `${w.times} times`}, last {relativeTime(w.lastAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
