import { describe, expect, it } from "vitest";

import {
  artifactTarget,
  EMPTY_TRANSCRIPT,
  isAppKey,
  isServedPath,
  MAX_LINES,
  readArtifact,
  receiveArtifacts,
  receiveChunk,
  shownEntries,
  type Chunk,
  type Line,
  type Transcript,
} from "./call-transcript";

const YOU = "me1";
const AGENT = "ag1";
const AGENT_TRACK = "TR_agent";
const base = { sender: AGENT, you: YOU, agentTracks: new Set([AGENT_TRACK]) };

/** The agent's reply, as agents-js streams it: chunks of one stream on the agent's own track. */
const reply = (t: Transcript, segment: string, chunk: string, final = false, stream = `s-${segment}`): Transcript =>
  receiveChunk(t, { ...base, chunk, stream, attributes: { "lk.segment_id": segment, "lk.transcribed_track_id": AGENT_TRACK, "lk.transcription_final": String(final) } });

/** The person's words, sent whole on a new stream each time the recogniser changes its mind. */
let streams = 0;
const heard = (t: Transcript, segment: string, text: string, final = false): Transcript =>
  receiveChunk(t, { ...base, chunk: text, stream: `u-${streams++}`, attributes: { "lk.segment_id": segment, "lk.transcribed_track_id": "TR_mic", "lk.transcription_final": String(final) } });

const lines = (t: Transcript) => shownEntries(t).map((e) => (e.kind === "line" ? `${e.speaker}: ${e.text}${e.final ? "" : "…"}` : `[${e.cards.map((c) => c.id).join(",")}]`));

const payload = (id: string, artifacts: unknown[]) => JSON.stringify({ id, timestamp: 1, artifacts });
const doc = (id: string) => ({ id, kind: "markdown", title: `Doc ${id}`, url: `/jobs/j-1/files/${id}.md` });

describe("the transcript", () => {
  it("adds up the agent's reply word by word, and replaces the person's words as they are revised", () => {
    let t = heard(EMPTY_TRANSCRIPT, "u1", "can you");
    t = heard(t, "u1", "can you pull up the plan", true);
    t = reply(t, "a1", "Sure,");
    t = reply(t, "a1", " here it is.");
    expect(lines(t)).toEqual(["you: can you pull up the plan", "agent: Sure, here it is.…"]);
    t = reply(t, "a1", "Sure, here it is.", true, "s-a1-final");
    expect(lines(t)).toEqual(["you: can you pull up the plan", "agent: Sure, here it is."]);
  });

  it("knows whose words they are by the track transcribed: the agent's own, else the person's", () => {
    const t = receiveChunk(EMPTY_TRANSCRIPT, { ...base, chunk: "hi", stream: "x", attributes: { "lk.segment_id": "s", "lk.transcribed_track_id": "TR_unknown" } });
    expect((t.entries[0] as Line).speaker).toBe("you");
    const mine = receiveChunk(EMPTY_TRANSCRIPT, { ...base, sender: YOU, chunk: "hi", stream: "x", attributes: {} } as Chunk);
    expect((mine.entries[0] as Line).speaker).toBe("you");
    const theirs = receiveChunk(EMPTY_TRANSCRIPT, { ...base, chunk: "hi", stream: "x", attributes: {} });
    expect((theirs.entries[0] as Line).speaker).toBe("agent");
  });

  it("keeps the newest lines", () => {
    let t = EMPTY_TRANSCRIPT;
    for (let i = 0; i < MAX_LINES + 5; i++) t = heard(t, `u${i}`, `line ${i}`, true);
    expect(t.entries).toHaveLength(MAX_LINES);
    expect((t.entries[0] as Line).text).toBe("line 5");
    expect(Object.keys(t.raw)).toHaveLength(MAX_LINES);
  });

  it("shows text, not control characters or runs of space", () => {
    const t = reply(EMPTY_TRANSCRIPT, "a", "one\u0007  two\n\nthree");
    expect((t.entries[0] as Line).text).toBe("one two three");
  });
});

describe("the cards", () => {
  it("go under the reply being said when they come", () => {
    let t = reply(EMPTY_TRANSCRIPT, "a1", "Here is the plan");
    t = receiveArtifacts(t, payload("p1", [doc("plan")]));
    t = heard(t, "u1", "thanks", true);
    expect(lines(t)).toEqual(["agent: Here is the plan…", "[plan]", "you: thanks"]);
  });

  it("wait for the next line when they come between turns: under the agent's reply, above the person's words", () => {
    let t = heard(EMPTY_TRANSCRIPT, "u1", "show me", true);
    t = receiveArtifacts(t, payload("p1", [doc("plan")]));
    expect(lines(t)).toEqual(["you: show me", "[plan]"]);
    t = reply(t, "a1", "On your screen.");
    expect(lines(t)).toEqual(["you: show me", "agent: On your screen.…", "[plan]"]);

    let u = receiveArtifacts(EMPTY_TRANSCRIPT, payload("p2", [doc("a"), doc("b")]));
    u = heard(u, "u1", "great", true);
    expect(lines(u)).toEqual(["[a,b]", "you: great"]);
  });

  it("add nothing for a payload seen before, malformed, or with nothing to show", () => {
    let t = receiveArtifacts(EMPTY_TRANSCRIPT, payload("p1", [doc("plan")]));
    t = receiveArtifacts(t, payload("p1", [doc("plan")]));
    expect(lines(t)).toEqual(["[plan]"]);
    expect(receiveArtifacts(EMPTY_TRANSCRIPT, "not json")).toBe(EMPTY_TRANSCRIPT);
    expect(receiveArtifacts(EMPTY_TRANSCRIPT, JSON.stringify({ artifacts: [doc("x")] }))).toBe(EMPTY_TRANSCRIPT);
    expect(shownEntries(receiveArtifacts(EMPTY_TRANSCRIPT, payload("p3", [{ id: "e", title: "x", error: "gone" }])))).toEqual([]);
  });
});

describe("where an artifact opens", () => {
  it("opens strut's own files in its viewer, a peer's through strut's read-through", () => {
    expect(artifactTarget(doc("plan"))).toEqual({ artifact: "/jobs/j-1/files/plan.md" });
    expect(artifactTarget({ url: "/artifacts/run-9/out.html" })).toEqual({ artifact: "/artifacts/run-9/out.html" });
    expect(artifactTarget({ peer: "acme-web", job: "peer/j-7", path: "shots/001.png" })).toEqual({ artifact: "/peers/acme-web/jobs/peer/j-7/files/shots/001.png" });
    expect(artifactTarget({ peer: "a", via: "b", job: "j", path: "/x.md" })).toEqual({ artifact: "/peers/a/peers/b/jobs/j/files/x.md" });
  });

  it("opens an app by its key, pinned to the version handed over", () => {
    expect(artifactTarget({ kind: "app", app: { name: "bench", version: "v3" }, url: "/apps/bench/v3/files/dist/index.html" })).toEqual({ app: "bench@v3" });
    expect(artifactTarget({ kind: "app", app: { name: "acme/hvac/invoices" } })).toEqual({ app: "acme/hvac/invoices" });
    expect(artifactTarget({ kind: "app", peer: "acme", app: { name: "ui", version: "v1" } })).toEqual({ app: "@acme/ui@v1" });
  });

  it("opens an https page as a link, and nothing else", () => {
    expect(artifactTarget({ kind: "pull_request", url: "https://github.com/acme/web/pull/12" })).toEqual({ href: "https://github.com/acme/web/pull/12" });
    for (const url of ["http://x.example", "javascript:alert(1)", "/jobs/../secrets", "/settings", "/jobs/j/files/a?b"]) {
      expect(artifactTarget({ url })).toBeNull();
    }
    expect(artifactTarget({ peer: "../x", job: "j", path: "a" })).toBeNull();
  });

  it("checks what the viewer and the app frame are handed", () => {
    expect(isServedPath("/jobs/j-1/files/a/b.md")).toBe(true);
    expect(isServedPath("/jobs/j-1/files/../../x")).toBe(false);
    expect(isServedPath("https://x/jobs/j/files/a")).toBe(false);
    expect(isAppKey("strut/jamie")).toBe(true);
    expect(isAppKey("@peer/name@v2")).toBe(true);
    expect(isAppKey("bad key")).toBe(false);
    expect(isAppKey("x@latest")).toBe(false);
  });

  it("reads a card from strut's entry", () => {
    expect(readArtifact({ id: "pr", kind: "pull_request", title: "Fix login", summary: "Two files", url: "https://github.com/a/b/pull/1" })).toEqual({
      id: "pr",
      title: "Fix login",
      kind: "pull_request",
      summary: "Two files",
      target: { href: "https://github.com/a/b/pull/1" },
    });
    expect(readArtifact({ id: "x", title: "" })).toMatchObject({ title: "x", kind: "url", target: null });
    expect(readArtifact(null)).toBeNull();
  });
});
