"use client";

import { useState } from "react";

import { money } from "@/lib/format";
import type { Bucket } from "@/lib/spend/report";

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" });

/** "Nov 4", or "3 PM" for hourly buckets; the gateway's buckets are UTC. */
function label(at: number, hourly: boolean) {
  return hourly ? `${hourFmt.format(at)} UTC` : dayFmt.format(at);
}

/** A rounded-up scale line: $1, $2, $5, $10, $20, $50… */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (max <= m * p) return m * p;
  return 10 * p;
}

/** Spend per bucket, one series: a bar per day (or hour), the value of the one under the pointer. */
export function SpendChart({ buckets, hourly }: { buckets: Bucket[]; hourly: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...buckets.map((b) => b.cost), 0));
  const shown = hover !== null ? buckets[hover] : undefined;
  const first = buckets[0];
  const last = buckets.at(-1);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between text-[13px] text-ink-3">
        <span>{hourly ? "Per hour" : "Per day"}</span>
        <span className="tabular-nums">{shown ? `${label(shown.at, hourly)} · ${money(shown.cost)}` : " "}</span>
      </div>
      <div className="relative h-40 pr-12">
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 bottom-1/2 translate-y-1/2 text-[11px] text-ink-3 tabular-nums"
        >
          {money(top / 2, { whole: top >= 4 })}
        </span>
        <div
          role="img"
          aria-label={`Spend ${hourly ? "per hour" : "per day"}, highest ${money(Math.max(...buckets.map((b) => b.cost), 0))}`}
          className="relative flex h-full items-end gap-0.5 border-b border-rule-strong"
          onMouseLeave={() => setHover(null)}
        >
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-1/2 border-t border-rule-soft" />
          {buckets.map((b, i) => (
            <span
              key={b.at}
              className="flex h-full min-w-0 flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              title={`${label(b.at, hourly)}: ${money(b.cost)}`}
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors duration-100 ${
                  b.cost > 0 ? (hover === i ? "bg-accent-hover" : "bg-accent") : "bg-rule"
                }`}
                style={{ height: b.cost > 0 ? `max(${(b.cost / top) * 100}%, 2px)` : "2px" }}
              />
            </span>
          ))}
        </div>
      </div>
      <div className="flex justify-between pr-12 text-[11px] text-ink-3">
        <span>{first ? label(first.at, hourly) : ""}</span>
        <span>{last ? label(last.at, hourly) : ""}</span>
      </div>
    </div>
  );
}
