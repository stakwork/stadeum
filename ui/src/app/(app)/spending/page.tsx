import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionLabel } from "@/components/page-header";
import { absoluteTime, compact, money, relativeTime } from "@/lib/format";
import { bucketFor, isWindow, NEAR, spendView, WINDOWS, windowLabel, type SpendView } from "@/lib/spend/report";
import { requireAdmin } from "@/lib/session";
import { readLimitSettings, recentChanges } from "@/lib/spend/limits";
import type { LimitSettings } from "@/lib/spend/rules";
import { SpendChart } from "./chart";
import { DefaultsForm, PersonLimit } from "./forms";

export const metadata: Metadata = { title: "Spending" };
export const dynamic = "force-dynamic";

type By = "person" | "model";
type Props = { searchParams: Promise<{ window?: string; by?: string }> };

const note = "rounded-xl border border-dashed border-dash px-5 py-8 text-[14px] text-ink-2";
const card = "rounded-[14px] border border-rule bg-surface shadow-soft";

const href = (window: string, by: By) => `/spending?window=${window}&by=${by}`;

/**
 * What the organisation spends on AI, and where each person stands against
 * their limit, read from the gateway, and the limits admins set: written to
 * every person's gateway budget, each change recorded. Periods are rolling:
 * the gateway's reports look back from now.
 */
export default async function SpendingPage({ searchParams }: Props) {
  await requireAdmin();
  const q = await searchParams;
  const window = isWindow(q.window) ? q.window : "30d";
  const by: By = q.by === "model" ? "model" : "person";
  const [view, settings, changes] = await Promise.all([
    spendView(window).catch((err: unknown): SpendView | null => {
      console.warn(`[spend] page read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    readLimitSettings(),
    recentChanges(),
  ]);

  return (
    <>
      <PageHeader title="Spending">
        <nav aria-label="Period" className="inline-flex gap-0.5 rounded-[10px] bg-raised p-[3px]">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={href(w, by)}
              aria-current={w === window ? "page" : undefined}
              className={`flex h-8 items-center rounded-lg px-3 text-[13px] transition-colors duration-150 ${
                w === window ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:text-ink"
              }`}
            >
              {windowLabel[w]}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {!view ? (
        <p className={note}>The gateway isn&rsquo;t answering, so spending can&rsquo;t be read right now.</p>
      ) : (
        <>
          <Totals view={view} />
          <section aria-label="Spend over time" className={`${card} p-5 md:p-6`}>
            <SpendChart buckets={view.buckets} hourly={bucketFor(window) === "1h"} />
          </section>
          <Breakdown view={view} by={by} settings={settings} />
        </>
      )}

      <section aria-labelledby="limits" className="flex flex-col gap-3">
        <SectionLabel id="limits">Limits</SectionLabel>
        <DefaultsForm limit={settings.limitUsd} reset={settings.reset} />
        {changes.length > 0 && (
          <ol aria-label="Recent changes" className={`${card} divide-y divide-rule-soft`}>
            {changes.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]"
              >
                <span className="min-w-0 text-ink-2">
                  <span className="text-ink">{c.byEmail}</span> changed{" "}
                  {c.subject === "everyone" ? "everyone’s limit" : <span className="text-ink">{c.subject}</span>}
                  {c.subject === "everyone" ? "" : "’s limit"} from {c.before} to {c.after}
                </span>
                <time
                  dateTime={c.createdAt.toISOString()}
                  title={absoluteTime(c.createdAt)}
                  className="shrink-0 text-[12.5px] text-ink-3"
                >
                  {relativeTime(c.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function Totals({ view }: { view: SpendView }) {
  const flagged = view.people.filter((p) => p.near || p.reached);
  return (
    <section aria-label="Totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
      <Stat label="Spent" value={money(view.total)} sub={`Last ${windowLabel[view.window]}`} />
      <Stat
        label="Tokens"
        value={compact(view.tokens.input + view.tokens.output)}
        sub={`${compact(view.tokens.input)} in · ${compact(view.tokens.output)} out`}
      />
      <Stat
        label="At or near their limit"
        value={String(flagged.length)}
        sub={
          flagged.length ? (
            <a href="#people" className="text-accent hover:text-accent-hover">
              {flagged.map((p) => (p.reached ? `${p.name} (reached)` : p.name)).join(", ")}
            </a>
          ) : (
            `Everyone under ${Math.round(NEAR * 100)}%`
          )
        }
      />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className={`${card} flex min-w-0 flex-col gap-2 p-5`}>
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="font-serif text-[36px] leading-none tracking-[-0.02em] text-ink tabular-nums md:text-[40px]">
        {value}
      </span>
      <span className="truncate text-[13px] text-ink-3">{sub}</span>
    </div>
  );
}

function Breakdown({ view, by, settings }: { view: SpendView; by: By; settings: LimitSettings }) {
  const th = "px-4 py-2.5 text-left text-[12px] font-semibold text-ink-3 first:pl-5 last:pr-5";
  const td = "px-4 py-3 align-middle first:pl-5 last:pr-5";
  return (
    <section id="people" aria-labelledby="by" className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <h2 id="by" className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase md:text-[13px]">
          Spend by
        </h2>
        <nav aria-label="Group by" className="inline-flex gap-0.5 rounded-lg bg-raised p-0.5">
          {(["person", "model"] as const).map((b) => (
            <Link
              key={b}
              href={href(view.window, b)}
              scroll={false}
              aria-current={b === by ? "page" : undefined}
              className={`flex h-7 items-center rounded-md px-2.5 text-[13px] ${b === by ? "bg-surface font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {b === "person" ? "Person" : "Model"}
            </Link>
          ))}
        </nav>
      </div>
      <div className="overflow-x-auto">
        {by === "person" ? (
          view.people.length === 0 ? (
            <p className="px-5 py-8 text-[14px] text-ink-2">Nobody has signed in yet.</p>
          ) : (
            <table className="w-full min-w-[680px] border-collapse text-[14px]">
              <thead className="border-b border-rule-soft">
                <tr>
                  <th className={th}>Person</th>
                  <th className={`${th} text-right`}>Spent</th>
                  <th className={`${th} text-right`}>Tokens</th>
                  <th className={th}>Their limit</th>
                  <th className={th}>
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.people.map((p) => (
                  <tr key={p.userId || p.name} className="border-b border-rule-soft last:border-b-0">
                    <td className={`${td} max-w-[220px]`}>
                      <span className="block truncate text-ink">{p.name}</span>
                      {p.ownLimit !== null && <span className="text-[12px] text-ink-3">Own limit</span>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(p.spent)}</td>
                    <td className={`${td} text-right text-ink-2 tabular-nums`}>{compact(p.tokens)}</td>
                    <td className={`${td} w-[42%]`}>
                      {p.limit === null || p.used === null ? (
                        <span className="text-[13px] text-ink-3">
                          {p.userId ? "Set at first sign-in" : "No longer a member"}
                        </span>
                      ) : (
                        <span className="flex items-center gap-3">
                          {p.reached && (
                            <span className="shrink-0 text-[13px] font-medium text-warn">Limit reached</span>
                          )}
                          <span
                            role="meter"
                            aria-label={`${p.name}’s limit used`}
                            aria-valuemin={0}
                            aria-valuemax={p.limit}
                            aria-valuenow={p.used}
                            className="relative h-1.5 min-w-16 flex-1 rounded-full bg-rule-soft"
                          >
                            <span
                              className={`absolute inset-y-0 left-0 rounded-full ${p.near || p.reached ? "bg-warn" : "bg-accent"}`}
                              style={{ width: `${Math.min(100, (p.used / p.limit) * 100)}%` }}
                            />
                          </span>
                          <span
                            className={`shrink-0 text-[12.5px] tabular-nums ${p.near || p.reached ? "text-warn" : "text-ink-3"}`}
                          >
                            {money(p.used, { whole: p.limit >= 100 })} {p.reached ? "spent" : "used"} of{" "}
                            {money(p.limit, { whole: p.limit >= 100 })} {p.period}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className={`${td} w-px whitespace-nowrap`}>
                      {p.userId && (
                        <PersonLimit
                          userId={p.userId}
                          name={p.name}
                          ownLimit={p.ownLimit}
                          defaultLimit={settings.limitUsd}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : view.models.length === 0 ? (
          <p className="px-5 py-8 text-[14px] text-ink-2">No model calls in the last {windowLabel[view.window]}.</p>
        ) : (
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <thead className="border-b border-rule-soft">
              <tr>
                <th className={th}>Model</th>
                <th className={`${th} text-right`}>Spent</th>
                <th className={`${th} text-right`}>Tokens</th>
                <th className={th}>Share</th>
              </tr>
            </thead>
            <tbody>
              {view.models.map((m) => (
                <tr key={m.name} className="border-b border-rule-soft last:border-b-0">
                  <td className={`${td} max-w-[280px] truncate font-mono text-[13px] text-ink`}>{m.name}</td>
                  <td className={`${td} text-right tabular-nums`}>{m.spent ? money(m.spent) : "Free"}</td>
                  <td className={`${td} text-right text-ink-2 tabular-nums`}>{compact(m.tokens)}</td>
                  <td className={`${td} w-[34%]`}>
                    <span className="flex items-center gap-3">
                      <span className="relative h-1.5 flex-1 rounded-full bg-rule-soft">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-accent"
                          style={{ width: `${m.share * 100}%` }}
                        />
                      </span>
                      <span className="w-10 shrink-0 text-right text-[12.5px] text-ink-3 tabular-nums">
                        {Math.round(m.share * 100)}%
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
