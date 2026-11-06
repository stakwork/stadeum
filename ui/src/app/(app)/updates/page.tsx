import type { Metadata } from "next";

import Link from "next/link";

import { buttonClass } from "@/components/button";
import { History, OpsNow, shortImage, tagOf } from "@/components/ops";
import { PageHeader, SectionLabel } from "@/components/page-header";
import { Dot } from "@/components/state";
import { absoluteTime, relativeTime } from "@/lib/format";
import { channelLine } from "@/lib/ops/channel";
import type { ReleaseStatus, ServiceImage } from "@/lib/ops/contract";
import { history, openRequests, readStatus, settingsForOps, settingsRow } from "@/lib/ops/store";
import { requireAdmin } from "@/lib/session";
import { checkNow, confirmRelease, updateNow } from "./actions";
import { ScheduleForm } from "./forms";

export const metadata: Metadata = { title: "Updates" };
export const dynamic = "force-dynamic";

function timeZones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return [...new Set(["UTC", current, ...all])];
}

const td = "px-5 py-3.5 align-top";

/** A service as the page names it. */
const NAMES: Record<string, string> = { neo4j: "Neo4j", caddy: "Caddy", redis: "Redis", bifrost: "the gateway" };
const named = (service: string) => NAMES[service] ?? service;
const upgrade = (held: NonNullable<ReleaseStatus["held"]>) =>
  held.map((h) => `${named(h.service)} from ${tagOf(h.from)} to ${tagOf(h.to)}`).join(" and ");

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
  const release = report?.status.release;
  const held = release?.held ?? [];
  const confirming = asked.includes("confirm");

  return (
    <>
      <PageHeader
        title="Updates"
        lede="strut and stadeum follow their stable channels. A stadeum release brings the stack files it runs with, and every pin in them. In the window each night, ops moves them, checks their health, and puts the previous ones back if they fail it."
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

      {held.length > 0 && (
        <section aria-labelledby="held" className="flex max-w-3xl flex-col gap-4 rounded-[14px] border border-warn bg-warn-soft p-5 md:p-6">
          <h2 id="held" className="text-[17px] font-medium text-ink">
            A release is waiting for you
          </h2>
          <p className="text-[14.5px] text-ink-2">
            {release?.available ? <>Release {shortImage(release.available)} </> : <>The next release </>}
            upgrades {upgrade(held)}. A store a newer Neo4j wrote cannot be opened by the older one, so this cannot be undone. ops
            takes a fresh backup first, then applies the release. Nothing in it moves until you confirm.
          </p>
          {confirming ? (
            <p className="text-[14px] text-ink-2">Confirmed: ops backs up, then upgrades, within half a minute.</p>
          ) : forOps.backups ? (
            <form action={confirmRelease}>
              <input type="hidden" name="target" value={held.map((h) => h.to).join(",")} />
              <button type="submit" className={buttonClass.primary}>
                Upgrade {held.length === 1 ? named(held[0]!.service) : "them"}
              </button>
            </form>
          ) : (
            <p className="text-[14px] text-ink-2">
              It needs a backup first, and none is set up: pick a destination on{" "}
              <Link href="/backups" className="text-accent underline underline-offset-2">
                Backups
              </Link>
              , then come back here.
            </p>
          )}
        </section>
      )}

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
                Asked the registries what the channels name <time title={absoluteTime(checkedAt)}>{relativeTime(checkedAt)}</time>; ops asks every 10
                minutes.
              </>
            ) : (
              "ops has not asked the registries yet."
            )}
          </p>
        </div>
      </section>

      {release && <Release release={release} held={held.length > 0} />}

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
                  <ImageRow key={s.service} s={s} channel={<Channel s={s} failed={failed} held={held.length > 0} />} />
                ))}
                {pinned.length > 0 && (
                  <tr className="border-t border-rule-soft">
                    <td colSpan={3} className="px-5 pt-5 pb-1 text-[12px] text-ink-3">
                      Pinned in the release&apos;s stack files: each moves when a release changes its pin, and Neo4j only when you
                      confirm it. To pin one on this box alone, set its image in <code className="font-mono">stack/local.yml</code>.
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

function Channel({ s, failed, held }: { s: ServiceImage; failed: Set<string>; held: boolean }) {
  const line = channelLine(s, { failed, held });
  return (
    <span className="flex flex-col gap-0.5" title={line.title}>
      <span>
        <Dot tone={line.tone} label={line.label} />
      </span>
      {line.note && <span className="text-[12.5px] text-ink-3 [overflow-wrap:anywhere]">{line.note}</span>}
    </span>
  );
}

/** stadeum's release: what runs, and what the next one changes. */
function Release({ release, held }: { release: ReleaseStatus; held: boolean }) {
  const moves = release.images ?? [];
  return (
    <section aria-labelledby="release" className="flex flex-col gap-3">
      <SectionLabel id="release">Release</SectionLabel>
      <div className="flex flex-col gap-3 rounded-[14px] border border-rule bg-surface p-5 text-[14px] md:p-6">
        <p className="text-ink-2">
          Running release <code className="font-mono text-[13px] text-ink">{shortImage(release.running)}</code>: ops&apos;s image, with
          stadeum-ui&apos;s and the stack files they run with. The box&apos;s own changes go in{" "}
          <code className="font-mono text-[13px]">stack/local.yml</code> and <code className="font-mono text-[13px]">.env</code>, which a
          release never touches.
        </p>
        {release.available && (
          <div className="flex flex-col gap-1.5">
            <span>
              <Dot
                tone={held ? "attention" : "pending"}
                label={`Release ${shortImage(release.available)} is out${held ? ": waiting for you" : ": next window, or Update now"}`}
              />
            </span>
            <span className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">
              {release.files?.length ? (
                <>
                  Changes {release.files.map((f, i) => (
                    <span key={f}>
                      {i > 0 && ", "}
                      <code className="font-mono">stack/{f}</code>
                    </span>
                  ))}
                  .
                </>
              ) : (
                "Changes no stack file."
              )}{" "}
              {moves.map((m) => (
                <span key={m.service}>
                  {named(m.service)}: {m.from ? tagOf(m.from) : "new"} → {m.to ? tagOf(m.to) : "removed"}.{" "}
                </span>
              ))}
            </span>
          </div>
        )}
        {release.problem && <Dot tone="attention" label={`Could not read the channel's release: ${release.problem}`} />}
      </div>
    </section>
  );
}
