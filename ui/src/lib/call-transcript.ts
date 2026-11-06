/**
 * What a call shows as it goes: the words both sides say, and the things the
 * assistant hands over. Pure: the call's room feeds it (lib/call-room.ts),
 * the page draws it, nothing keeps it. When the call ends it is gone; the
 * conversation itself is strut's.
 *
 * The words come as LiveKit Agents publish them, text streams on
 * `lk.transcription`, folded as LiveKit's own `TranscriptionStreamReceiver`
 * (and Peel's `TalkTranscript`) folds them: one line per speaker and
 * `lk.segment_id`; chunks of one stream add up (the agent's reply, word by
 * word in time with its audio), and a new stream for a segment replaces it
 * (the person's words, sent whole each time the recogniser changes its
 * mind). The agent publishes both sides; whose words they are is
 * `lk.transcribed_track_id`: the agent's own track, or the person's.
 *
 * The things come as sphinx-voice sends them (`plans/call-artifacts.md`):
 * one text stream on `sphinx.artifacts` per turn, `{ id, timestamp,
 * artifacts: [strut ArtifactRef…] }`. Each is a reference, opened through
 * strut, never drawn here (AGENTS.md rule 2).
 */

export const TRANSCRIPT_TOPIC = "lk.transcription";
export const ARTIFACTS_TOPIC = "sphinx.artifacts";

export type Speaker = "you" | "agent";

export interface Line {
  kind: "line";
  /** `<speaker>/<segment>`. */
  id: string;
  speaker: Speaker;
  text: string;
  /** The segment is done; a line still coming may change. */
  final: boolean;
}

/** Where a click on an artifact goes: strut's viewer for one of its files, an app of strut's, or a web page. */
export type ArtifactTarget = { artifact: string } | { app: string } | { href: string };

export interface CallArtifact {
  id: string;
  title: string;
  /** strut's renderer vocabulary: markdown, app, image, pull_request, … */
  kind: string;
  label?: string;
  summary?: string;
  /** Null: nothing here can open it (shown, not linked). */
  target: ArtifactTarget | null;
}

export interface Cards {
  kind: "cards";
  id: string;
  cards: CallArtifact[];
}

export type Entry = Line | Cards;

export interface Transcript {
  entries: Entry[];
  /** Cards that came while no reply was being said: placed by the next line. */
  pending: Cards | null;
  /** Each line's text as it came, and the stream that last wrote it. */
  raw: Record<string, { text: string; stream: string }>;
  /** Artifact payloads seen, by id: one seen again adds nothing. */
  seen: string[];
}

export const EMPTY_TRANSCRIPT: Transcript = { entries: [], pending: null, raw: {}, seen: [] };

/** The newest lines kept, the most characters a line holds, the most cards a payload brings. */
export const MAX_LINES = 200;
const MAX_TEXT = 4000;
const MAX_CARDS = 20;

/** Text made safe to show: control characters gone, runs of space one, trimmed, capped. */
const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export interface Chunk {
  chunk: string;
  /** The text stream's id. */
  stream: string;
  /** The stream's attributes (`lk.segment_id`, `lk.transcribed_track_id`, `lk.transcription_final`). */
  attributes: Record<string, string>;
  /** Who sent the stream. */
  sender: string;
  /** The person's identity in the room. */
  you: string;
  /** The agent's tracks, by id. */
  agentTracks: ReadonlySet<string>;
}

/** Whose words a stream carries: the agent's own track's, else the person's. */
export function speakerOf(c: Pick<Chunk, "attributes" | "sender" | "you" | "agentTracks">): Speaker {
  const track = c.attributes["lk.transcribed_track_id"];
  if (c.sender === c.you) return "you";
  if (track) return c.agentTracks.has(track) ? "agent" : "you";
  return "agent";
}

/** One chunk of a transcription stream, folded in. */
export function receiveChunk(t: Transcript, c: Chunk): Transcript {
  const speaker = speakerOf(c);
  const segment = c.attributes["lk.segment_id"] || c.stream;
  const id = `${speaker}/${segment}`;
  const final = c.attributes["lk.transcription_final"] === "true";
  const earlier = t.raw[id];
  const text = (earlier && earlier.stream === c.stream ? earlier.text + c.chunk : c.chunk).slice(0, MAX_TEXT);
  const raw = { ...t.raw, [id]: { text, stream: c.stream } };
  const shown = clean(text, MAX_TEXT);

  const at = t.entries.findIndex((e) => e.kind === "line" && e.id === id);
  if (at >= 0) {
    const entries = t.entries.slice();
    entries[at] = { ...(entries[at] as Line), text: shown, final };
    return { ...t, entries, raw };
  }
  // A new line places the cards that were waiting: under it when it is the
  // agent's reply, above it when it is the person speaking.
  const line: Line = { kind: "line", id, speaker, text: shown, final };
  const added = !t.pending ? [line] : speaker === "agent" ? [line, t.pending] : [t.pending, line];
  return cap({ ...t, entries: [...t.entries, ...added], pending: null, raw });
}

/** Keeps the newest MAX_LINES lines, and the cards among them. */
function cap(t: Transcript): Transcript {
  let lines = 0;
  let from = t.entries.length;
  while (from > 0 && (lines < MAX_LINES || t.entries[from - 1]!.kind === "cards")) {
    from -= 1;
    if (t.entries[from]!.kind === "line") lines += 1;
  }
  if (from === 0) return t;
  const gone = t.entries.slice(0, from);
  const raw = { ...t.raw };
  for (const e of gone) if (e.kind === "line") delete raw[e.id];
  return { ...t, entries: t.entries.slice(from), raw };
}

/**
 * One `sphinx.artifacts` payload, folded in: under the reply being said
 * when it came (a card usually comes just before its reply's words, which
 * follow the audio), else waiting for the next line.
 */
export function receiveArtifacts(t: Transcript, text: string): Transcript {
  if (text.length > 256 * 1024) return t;
  let payload: { id?: unknown; artifacts?: unknown };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    return t;
  }
  const id = typeof payload?.id === "string" ? payload.id : "";
  if (!id || !Array.isArray(payload.artifacts) || t.seen.includes(id)) return t;
  const cards = payload.artifacts.slice(0, MAX_CARDS).map(readArtifact).filter((a): a is CallArtifact => a !== null);
  const seen = [...t.seen, id].slice(-100);
  if (!cards.length) return { ...t, seen };

  const last = t.entries.at(-1);
  if (!t.pending && last?.kind === "line" && last.speaker === "agent" && !last.final) {
    return { ...t, entries: [...t.entries, { kind: "cards", id, cards }], seen };
  }
  const pending: Cards = t.pending ? { ...t.pending, cards: [...t.pending.cards, ...cards] } : { kind: "cards", id, cards };
  return { ...t, pending, seen };
}

/** What the page shows: the entries, and cards still waiting for a line at the end. */
export const shownEntries = (t: Transcript): Entry[] => (t.pending ? [...t.entries, t.pending] : t.entries);

// ── an artifact, read ───────────────────────────────────────────────────

const SEGMENT = /^[A-Za-z0-9._-]+$/;
/** A path on this strut that serves a file (strut's `isServedFilePath`), behind any `/peers/<id>` hops. */
const SERVED = /^(\/peers\/[A-Za-z0-9._-]+)*\/(jobs\/[^?#\s]+\/files|artifacts\/[A-Za-z0-9._-]+)\/[^?#\s]+$/;

/** A path the viewer may open: a served file, no `..` anywhere. */
export const isServedPath = (p: unknown): p is string =>
  typeof p === "string" && p.length <= 1024 && SERVED.test(p) && !p.split("/").includes("..");

/** strut's app key (`web/src/app-links.ts`): `name` (a package's may hold `/`), `@peer/name`, either pinned `@vN`. */
export const isAppKey = (k: unknown): k is string =>
  typeof k === "string" && k.length <= 200 && /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*(@v\d+)?$/.test(k);

const isWebLink = (u: unknown): u is string => {
  if (typeof u !== "string" || u.length > 2048) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Where an artifact opens, as strut UI's `linkOf` / `peerArtifactPath`
 * resolve one on this strut (the box's own: no workspace hop): a peer's
 * deliverable through strut's read-through, an app by its key, a file of
 * this strut by its path, a web page by its https link. Anything else is
 * shown without a link.
 */
export function artifactTarget(r: Record<string, unknown>): ArtifactTarget | null {
  const app = r.app && typeof r.app === "object" ? (r.app as { name?: unknown; version?: unknown }) : null;
  if (r.kind === "app" && app && typeof app.name === "string") {
    const version = typeof app.version === "string" && /^v\d+$/.test(app.version) ? `@${app.version}` : "";
    const peer = typeof r.peer === "string" && SEGMENT.test(r.peer) ? `@${r.peer}/` : "";
    const key = `${peer}${app.name}${version}`;
    return isAppKey(key) ? { app: key } : null;
  }
  if (typeof r.peer === "string") {
    if (!SEGMENT.test(r.peer) || typeof r.job !== "string" || typeof r.path !== "string") return null;
    const via = typeof r.via === "string" && SEGMENT.test(r.via) ? `/peers/${r.via}` : "";
    const path = `/peers/${r.peer}${via}/jobs/${r.job}/files/${r.path.replace(/^\/+/, "")}`;
    return isServedPath(path) ? { artifact: path } : null;
  }
  if (isServedPath(r.url)) return { artifact: r.url };
  if (isWebLink(r.url)) return { href: r.url };
  return null;
}

/** One of strut's ArtifactRef entries, as a card: null for an error, or one with nothing to show. */
export function readArtifact(entry: unknown): CallArtifact | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const r = entry as Record<string, unknown>;
  if (r.error || typeof r.id !== "string") return null;
  const title = typeof r.title === "string" ? clean(r.title, 200) : "";
  const text = (v: unknown, max: number) => (typeof v === "string" && clean(v, max) ? clean(v, max) : undefined);
  return {
    id: r.id,
    title: title || r.id,
    kind: typeof r.kind === "string" ? r.kind : "url",
    ...(text(r.label, 60) ? { label: text(r.label, 60) } : {}),
    ...(text(r.summary, 400) ? { summary: text(r.summary, 400) } : {}),
    target: artifactTarget(r),
  };
}
