/**
 * Where sign-in sends a person back to: the page they asked for, query and
 * all (the Packages page's store link among them). The middleware hands a
 * page its own address in `PATH_HEADER`; `requireUser` puts it on the
 * sign-in page's `?next=`; sign-in returns there. No imports: the
 * middleware runs it too.
 */

export const PATH_HEADER = "x-stadeum-path";

/**
 * `raw` when it is a path on this site a person may be sent to after
 * sign-in, else null: it starts with one `/` (never `//` or `/\`, another
 * host), holds no control character, and is not sign-in itself or an API.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (/^\/(signin|api)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

/** The sign-in page, coming back to `path` when it is one to come back to. */
export function signInHref(path: unknown): string {
  const next = safeNext(path);
  return next && next !== "/" ? `/signin?next=${encodeURIComponent(next)}` : "/signin";
}
