import { isCallKey } from "@/lib/calls";
import { currentUser } from "@/lib/session";
import { startVoiceCall } from "@/lib/strut/client";

/**
 * `POST /api/calls { key, voice? }`: a voice call with Jamie for the person
 * signed in (strut `specs/API.md` §15.2). The browser makes the call's key;
 * this hands it to strut `POST /voice/calls` with the deployment key and the
 * person as `x-strut-actor`, and answers with what strut answered: the
 * LiveKit room Jamie joined with the key (`lib/calls.ts`), or the refusal.
 *
 * The body and the answer hold the call's key and tokens: nothing of either
 * is logged or kept, and the answer is never cached.
 */
export const dynamic = "force-dynamic";

/** strut's own limit on the body. */
const BODY_MAX = 16 * 1024;
const VOICE_RE = /^[a-z]{2}_[a-z0-9_]{1,40}$/;

/** What the browser hears back; the statuses a person can act on pass through as strut gave them. */
const PASSED = new Set([200, 400, 402, 503]);

const answer = (data: unknown, status: number) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * A page of this site sent it: the `Origin` is this host, as Next checks a
 * server action. Strut's UI is on a subdomain, the same site, so the
 * session cookie alone would let one of its pages start a call (and end the
 * person's current one).
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return answer({ error: "sign in to call" }, 401);
  if (!sameOrigin(req)) return answer({ error: "a call starts from stadeum's own pages" }, 403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return answer({ error: "the body must be JSON" }, 415);

  const text = await req.text();
  if (text.length > BODY_MAX) return answer({ error: `a body is at most ${BODY_MAX} bytes` }, 413);
  let body: { key?: unknown; voice?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return answer({ error: "the body is not JSON" }, 400);
  }
  // Never a call in the clear: the key is required, not optional as strut has it.
  if (!isCallKey(body?.key)) return answer({ error: "key must be 32 bytes, as base64" }, 400);
  if (body.voice !== undefined && (typeof body.voice !== "string" || !VOICE_RE.test(body.voice))) {
    return answer({ error: "voice must be a voice name, like af_heart" }, 400);
  }

  let reply: { status: number; data: unknown };
  try {
    reply = await startVoiceCall(user.actor, { key: body.key, ...(body.voice ? { voice: body.voice as string } : {}) });
  } catch (err) {
    console.warn(`[calls] strut did not answer for ${user.actor}: ${err instanceof Error ? err.name : "error"}`);
    return answer({ error: "strut isn’t answering" }, 503);
  }
  if (PASSED.has(reply.status)) return answer(reply.data, reply.status);
  // 401/403/413 from strut are this box's to fix, not the person's.
  console.warn(`[calls] strut answered ${reply.status} to a call for ${user.actor}`);
  const detail = (reply.data as { error?: unknown } | null)?.error;
  return answer({ error: `strut answered ${reply.status}${typeof detail === "string" ? `: ${detail.slice(0, 200)}` : ""}` }, 502);
}
