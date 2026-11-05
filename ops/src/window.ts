import type { UpkeepWindow } from "./contract.js";

/**
 * The daily window, in the admin's time zone. A window may cross midnight
 * (23:00–01:00); it is named by the local date it opened on, so a pass
 * that ran in it is not run again when ops restarts inside the same window.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHMM(s: string): number {
  const m = HHMM.exec(s);
  if (!m) throw new Error(`not a time of day (HH:MM): ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The local date (YYYY-MM-DD) and minute of the day at `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The window `now` falls in, named by the date it opened on; null outside it. */
export function currentWindow(now: Date, w: UpkeepWindow): string | null {
  const start = parseHHMM(w.start);
  const end = parseHHMM(w.end);
  const { date, minutes } = localParts(now, w.timeZone);
  if (start < end) return minutes >= start && minutes < end ? date : null;
  // Crosses midnight, or start === end: the whole day.
  if (minutes >= start) return date;
  if (minutes < end || start === end) return dayBefore(date);
  return null;
}
