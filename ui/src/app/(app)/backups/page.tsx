import type { Metadata } from "next";
import Link from "next/link";

import { buttonClass } from "@/components/button";
import { History, OpsNow } from "@/components/ops";
import { PageHeader, SectionLabel } from "@/components/page-header";
import { absoluteTime, relativeTime } from "@/lib/format";
import { DESTINATIONS } from "@/lib/ops/destination";
import { destinationForPage, history, openRequests, pendingPassword, readStatus, settingsRow } from "@/lib/ops/store";
import { requireAdmin } from "@/lib/session";
import { backUpNow, passwordKept } from "./actions";
import { CopyButton, DestinationForm } from "./forms";

export const metadata: Metadata = { title: "Backups" };
export const dynamic = "force-dynamic";

const bytes = (n: number | undefined) =>
  n === undefined ? "" : n < 1e6 ? `${Math.round(n / 1e3)} kB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`;

export default async function BackupsPage() {
  await requireAdmin();
  const [row, dest, secret, report, asked, entries] = await Promise.all([
    settingsRow(),
    destinationForPage(),
    pendingPassword(),
    readStatus(),
    openRequests(),
    history(["backup", "restore"]),
  ]);
  const snapshots = report?.status.snapshots ?? [];

  return (
    <>
      <PageHeader
        title="Backups"
        lede="In the window each night, ops lets strut's runs finish, stops the services whose files would tear for a few minutes, and snapshots every volume and the .env file with restic."
      >
        {dest.kind && (
          <form action={backUpNow}>
            <button type="submit" className={buttonClass.primary}>
              Back up now
            </button>
          </form>
        )}
      </PageHeader>

      {secret && (
        <section aria-labelledby="password" className="flex max-w-3xl flex-col gap-4 rounded-[14px] border border-warn bg-warn-soft p-5 md:p-6">
          <h2 id="password" className="text-[17px] font-medium text-ink">
            Keep this password off the box
          </h2>
          <p className="text-[14.5px] text-ink-2">
            The backups are encrypted with it. The box keeps a copy to make them, but if the box is lost, so is that copy, and
            nobody can read the backups without it. Save the restore kit in your password manager. It is shown until you say you
            have, and never again.
          </p>
          <p className="text-[14px] text-ink-2">
            Password: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[14px] text-ink select-all">{secret.password}</code>
          </p>
          <pre className="overflow-x-auto rounded-[10px] border border-rule bg-surface p-4 font-mono text-[12.5px] leading-relaxed text-ink-2">
            {secret.kit}
          </pre>
          <div className="flex flex-wrap gap-3">
            <CopyButton text={secret.kit} />
            <form action={passwordKept}>
              <button type="submit" className={buttonClass.ink}>
                I have stored it off the box
              </button>
            </form>
          </div>
        </section>
      )}

      <section aria-labelledby="now" className="flex flex-col gap-3">
        <SectionLabel id="now">Now</SectionLabel>
        <div className="flex flex-col gap-4 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
          <OpsNow report={report} asked={asked.filter((k) => k === "backup")} />
          <p className="text-[13px] text-ink-3">
            {!dest.kind ? (
              "No destination yet: pick one below."
            ) : dest.enabled ? (
              <>
                Nightly in the window, {row.windowStart}–{row.windowEnd} {row.timeZone.replaceAll("_", " ")} (
                <Link href="/updates#schedule" className="underline underline-offset-2 hover:text-ink">
                  change it
                </Link>
                ), to <code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{dest.repository}</code>. Kept: 7 daily, 4 weekly, 12 monthly.
              </>
            ) : (
              "Nightly backups are off."
            )}
          </p>
        </div>
      </section>

      {snapshots.length > 0 && (
        <section aria-labelledby="snapshots" className="flex flex-col gap-3">
          <SectionLabel id="snapshots">Snapshots</SectionLabel>
          <ul className="divide-y divide-rule-soft overflow-hidden rounded-xl border border-rule bg-surface">
            {snapshots.slice(0, 10).map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3 text-[14px]">
                <code className="font-mono text-[13px] text-ink">{s.id.slice(0, 8)}</code>
                <time className="tabular text-ink-2" dateTime={s.time} title={absoluteTime(s.time)}>
                  {absoluteTime(s.time)} · {relativeTime(s.time)}
                </time>
                {s.added !== undefined && <span className="text-[13px] text-ink-3">{bytes(s.added)} added</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="destination" className="flex max-w-3xl flex-col gap-3">
        <SectionLabel id="destination">Destination</SectionLabel>
        <p className="text-[14px] text-ink-2">
          {dest.kind ? `${DESTINATIONS[dest.kind].label}.` : "Any of restic's backends: object storage in your own cloud account."}{" "}
          A new destination starts a new repository, encrypted with the same password.
        </p>
        <DestinationForm kind={dest.kind} fields={dest.fields} savedSecrets={dest.savedSecrets} enabled={dest.enabled} />
      </section>

      <section aria-labelledby="restore" className="flex max-w-3xl flex-col gap-3">
        <SectionLabel id="restore">Restore</SectionLabel>
        <div className="flex flex-col gap-3 text-[14px] text-ink-2">
          <p>
            On a fresh box, in a checkout of stadeum, with the restore kit saved as <code className="font-mono">restore.env</code>:
          </p>
          <pre className="overflow-x-auto rounded-[10px] border border-rule bg-surface p-4 font-mono text-[12.5px] leading-relaxed">
            {`scripts/init-env.sh
docker compose --env-file .env -f stack/stadeum.yml run --rm --env-from-file restore.env ops restore
docker compose --env-file .env -f stack/stadeum.yml up -d --wait`}
          </pre>
          <p>
            It restores the newest snapshot (name one to pick another: <code className="font-mono">ops restore 1a2b3c4d</code>),
            and the snapshot&apos;s <code className="font-mono">.env</code> with it. On this box, the same command puts a snapshot back.
          </p>
        </div>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <SectionLabel id="history">History</SectionLabel>
        <History entries={entries} empty="No backup yet." />
      </section>
    </>
  );
}
