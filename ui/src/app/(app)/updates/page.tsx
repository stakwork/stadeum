import type { Metadata } from "next";

import { buttonClass } from "@/components/button";
import { History, OpsNow, shortImage, tagOf } from "@/components/ops";
import { PageHeader, SectionLabel } from "@/components/page-header";
import { Dot } from "@/components/state";
import { absoluteTime, relativeTime } from "@/lib/format";
import type { ServiceImage } from "@/lib/ops/contract";
import { history, openRequests, readStatus, settingsForOps, settingsRow } from "@/lib/ops/store";
import { requireAdmin } from "@/lib/session";
import { checkNow, updateNow } from "./actions";
import { ScheduleForm } from "./forms";

export const metadata: Metadata = { title: "Updates" };
export const dynamic = "force-dynamic";

function timeZones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return [...new Set(["UTC", current, ...all])];
}

const td = "px-5 py-3.5 align-top";

export default async function UpdatesPage() {
  await requireAdmin();
  const [row, report, asked, entries, forOps] = await Promise.all([
    settingsRow(),
    readStatus(),
    openRequests(),
    history(["update"]),
    settingsForOps(),
  ]);
  const services = report?.status.services ?? [];
  const followed = services.filter((s) => s.group && !s.built);
  const pinned = services.filter((s) => !s.group || s.built);
  const failed = new Set(forOps.failedImages);
  const checkedAt = report?.status.checkedAt;

  return (
    <>
      <PageHeader
        title="Updates"
        lede="strut and stadeum follow their stable channels. In the window each night, ops moves them, checks their health, and puts the old images back if they fail it."
      >
        <div className="flex flex-wrap gap-3">
          <form action={checkNow}>
            <button type="submit" className={buttonClass.secondary}>
              Check now
            </button>
          </form>
          <form action={updateNow}>
            <button type="submit" className={buttonClass.primary}>
              Update now
            </button>
          </form>
        </div>
      </PageHeader>

      <section aria-labelledby="now" className="flex flex-col gap-3">
        <SectionLabel id="now">Now</SectionLabel>
        <div className="flex flex-col gap-4 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
          <OpsNow report={report} asked={asked} />
          <p className="text-[13px] text-ink-3">
            {row.updatesEnabled ? (
              <>
                Daily, {row.windowStart}–{row.windowEnd} {row.timeZone.replaceAll("_", " ")}.
              </>
            ) : (
              <>Automatic updates are off.</>
            )}{" "}
            {checkedAt ? (
              <>
                Last checked <time title={absoluteTime(checkedAt)}>{relativeTime(checkedAt)}</time>.
              </>
            ) : (
              "Not checked yet."
            )}
          </p>
        </div>
      </section>

      <section aria-labelledby="images" className="flex flex-col gap-3">
        <SectionLabel id="images">Images</SectionLabel>
        {services.length === 0 ? (
          <p className="text-[14px] text-ink-3">ops lists the images once it reports.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
            <table className="w-full min-w-[620px] border-collapse text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Service
                  </th>
                  <th scope="col" className="w-[150px] px-5 py-3 font-medium">
                    Running
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Channel
                  </th>
                </tr>
              </thead>
              <tbody>
                {followed.map((s) => (
                  <ImageRow key={s.service} s={s} channel={<Channel s={s} failed={failed} />} />
                ))}
                {pinned.length > 0 && (
                  <tr className="border-t border-rule-soft">
                    <td colSpan={3} className="px-5 pt-5 pb-1 text-[12px] text-ink-3">
                      Moved only by a person, after a backup: change its pin in <code className="font-mono">stack/stadeum.yml</code> (the
                      gateway&apos;s is <code className="font-mono">BIFROST_TAG</code>) and run <code className="font-mono">docker compose up -d</code>.
                    </td>
                  </tr>
                )}
                {pinned.map((s) => (
                  <ImageRow
                    key={s.service}
                    s={s}
                    channel={<span className="text-ink-3">{s.built ? "Built on this box" : <>Pinned · <code className="font-mono text-[13px]">{tagOf(s.image)}</code></>}</span>}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="schedule" className="flex max-w-3xl flex-col gap-3">
        <SectionLabel id="schedule">Window</SectionLabel>
        <p className="text-[14px] text-ink-2">The nightly backup runs in the same window, before the updates.</p>
        <ScheduleForm
          start={row.windowStart}
          end={row.windowEnd}
          timeZone={row.timeZone}
          drainMinutes={row.drainMinutes}
          enabled={row.updatesEnabled}
          zones={timeZones(row.timeZone)}
        />
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <SectionLabel id="history">History</SectionLabel>
        <History entries={entries} empty="Nothing has been updated yet." />
      </section>
    </>
  );
}

function ImageRow({ s, channel }: { s: ServiceImage; channel: React.ReactNode }) {
  return (
    <tr className="border-t border-rule-soft">
      <td className={td}>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{s.service}</span>
          <code className="font-mono text-[12px] text-ink-3 [overflow-wrap:anywhere]">{s.image}</code>
        </span>
      </td>
      <td className={`${td} font-mono text-[13px]`} title={s.running?.created ? `Built ${absoluteTime(s.running.created)}` : undefined}>
        {s.running ? shortImage(s.running) : <span className="text-ink-3">Not running</span>}
      </td>
      <td className={`${td} text-[13px]`}>{channel}</td>
    </tr>
  );
}

function Channel({ s, failed }: { s: ServiceImage; failed: Set<string> }) {
  if (!s.available) return <Dot tone="ok" label="Up to date" />;
  const label = `${shortImage(s.available)} is out`;
  if (failed.has(s.available.id)) return <Dot tone="attention" label={`${label}, held back: it failed its health check`} />;
  return <Dot tone="pending" label={`${label}: next window, or Update now`} />;
}
