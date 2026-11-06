/**
 * A voice call with Jamie: the pure parts, shared by the route that starts
 * one (`/api/calls`) and the browser that joins it (components/call.tsx).
 *
 * The contract is strut's (`specs/API.md` §15.2, `plans/private-voice.md`
 * §4.1): the browser makes a fresh key for the call, stadeum-ui's server
 * hands it to strut `POST /voice/calls` as the person, and the voice service
 * beside strut answers with a LiveKit room its agent has already joined
 * with that key. The browser joins with the same key, so the LiveKit server
 * forwards audio it cannot read. Nothing here logs, keeps or puts in a URL
 * the key, the room or the token.
 */

/** The answer of `POST /voice/calls`, checked. */
export interface CallAnswer {
  /** The LiveKit server: `wss://`, or `ws://` on this machine. */
  url: string;
  room: string;
  /** The person's LiveKit token, for `room` only. */
  token: string;
  /** The person's identity in the room, random per call. */
  identity: string;
  /** Jamie's identity in the room, random per call. */
  agent: string;
  /** The voice Jamie speaks in. */
  voice: string;
}

/** The participant attribute LiveKit Agents publish the agent's state in. */
export const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

/** A call's key: 32 random bytes as base64 (44 characters, one `=`). */
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

export const isCallKey = (key: unknown): key is string => typeof key === "string" && KEY_RE.test(key);

/**
 * A fresh key for one call. LiveKit keys the room with this STRING's UTF-8
 * bytes, not its base64 decoding: the browser (`ExternalE2EEKeyProvider`),
 * Peel and the voice service's agent all do, so all derive one AES key.
 */
export function newCallKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopback = (host: string) => LOOPBACK.has(host) || host.endsWith(".localhost");

/**
 * The LiveKit server as the browser may connect to it: `wss://` anywhere,
 * `ws://` only on this machine (`https://` and `http://` read as those). No
 * user, query or fragment. Null for anything else.
 */
export function mediaUrl(text: string): string | null {
  if (text.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const scheme = ({ "https:": "wss:", "http:": "ws:" } as Record<string, string>)[url.protocol] ?? url.protocol;
  if (url.username || url.password || url.search || url.hash || !url.hostname) return null;
  if (scheme !== "wss:" && !(scheme === "ws:" && isLoopback(url.hostname))) return null;
  return `${scheme}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
}

/** The `video.room` claim of a LiveKit token, without checking its signature (the server does). */
export function tokenRoom(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const claims = JSON.parse(json) as { video?: { room?: unknown } };
    return typeof claims.video?.room === "string" ? claims.video.room : null;
  } catch {
    return null;
  }
}

/** Room and identity names: short, printable, no spaces. */
const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reads `POST /voice/calls`'s answer as Peel does (`TalkTicket`): a LiveKit
 * server the browser may use, a token for the room named, two identities,
 * and the service's word that its agent joined with the call's key. An
 * answer without `encrypted: true` is refused: a call is never made in the
 * clear.
 */
export function readCallAnswer(data: unknown): { ok: true; answer: CallAnswer } | { ok: false; error: string } {
  const unreadable = { ok: false as const, error: "The call’s answer could not be read." };
  if (!data || typeof data !== "object") return unreadable;
  const d = data as Record<string, unknown>;
  if (d.encrypted !== true) {
    return { ok: false, error: "This box can’t make an encrypted call yet: its voice service needs an update." };
  }
  const url = typeof d.url === "string" ? mediaUrl(d.url) : null;
  if (!url) return { ok: false, error: "The call named a LiveKit server the browser can’t use: only wss://, or ws:// on this machine." };
  const { room, token, identity, agent } = d;
  if (![room, identity, agent].every((v) => typeof v === "string" && NAME_RE.test(v)) || typeof token !== "string") return unreadable;
  if (tokenRoom(token) !== room) return { ok: false, error: "The call’s token is not for the room it named." };
  return {
    ok: true,
    answer: {
      url,
      room: room as string,
      token,
      identity: identity as string,
      agent: agent as string,
      voice: typeof d.voice === "string" ? d.voice : "",
    },
  };
}

/** A message from the other side, made safe to show: one line, at most 300 characters. */
const clean = (s: unknown): string | undefined => {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
  return t || undefined;
};

/** A refusal of a call, in plain words, with the service's own after them. `assistant` is who is called. */
export function refusalMessage(status: number, data: unknown, assistant = "Jamie"): string {
  const d = (data && typeof data === "object" ? data : {}) as { error?: unknown; balance?: unknown; minimum?: unknown };
  const words = clean(d.error);
  const withWords = (lead: string) => (words ? `${lead}: ${words}` : `${lead}.`);
  if (status === 402) {
    if (typeof d.balance === "number" && typeof d.minimum === "number") {
      return `Not enough sats to talk: you have ${d.balance.toLocaleString("en")} sats, and a call needs ${d.minimum.toLocaleString("en")}.`;
    }
    return withWords("Not enough credit to talk");
  }
  if (status === 503) return withWords(`${assistant} can’t take calls right now`);
  if (status === 401) return "You’re signed out. Sign in again to call.";
  if (status === 400) return withWords(`${assistant} couldn’t start the call`);
  return withWords(`The call couldn’t start (HTTP ${status})`);
}

/** What the agent's state attribute (`lk.agent.state`) says, for the call screen. */
export function agentStateLabel(state: string | null, assistant = "Jamie"): string {
  switch (state) {
    case null:
      return `Waiting for ${assistant}…`;
    case "listening":
    case "idle":
      return "Listening";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking";
    default:
      return "Getting ready…";
  }
}

/** A call's length so far, as `m:ss` (or `h:mm:ss`). */
export function callDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
