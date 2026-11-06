/** Dates and durations as people say them. */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(date: Date | string | null | undefined, now: Date = new Date()): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(secs);
  if (abs < 45) return "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of units) {
    if (abs >= s) {
      unit = u;
      size = s;
    }
  }
  return rtf.format(Math.round(secs / size), unit);
}

export function absoluteTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function longDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Dollars: whole above $100 ("$1,284"), cents below ("$12.40"), "$0" for
 * nothing. `whole` drops the cents everywhere, so a column reads alike.
 */
export function money(usd: number, { whole = false }: { whole?: boolean } = {}): string {
  if (!usd) return "$0";
  const cents = !whole && Math.abs(usd) < 100;
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** Token counts: "940", "12k", "3.4M", "10M". Rounding never shows "1000k" or "10.0M". */
export function compact(n: number): string {
  if (n < 999.5) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  const m = n / 1e6;
  return m < 9.95 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}
