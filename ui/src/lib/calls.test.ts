import { describe, expect, it } from "vitest";

import { DEV_LIVEKIT, livekitToken } from "@/test/fake-stack";
import { agentStateLabel, callDuration, isCallKey, mediaUrl, newCallKey, readCallAnswer, refusalMessage, tokenRoom } from "./calls";

const ROOM = "sphinx.call.voice.0123456789abcdef0123456789abcdef";
const answer = (over: Record<string, unknown> = {}) => ({
  url: "wss://livekit.sphinx.chat",
  room: ROOM,
  token: livekitToken(DEV_LIVEKIT, "a1b2", ROOM),
  identity: "a1b2",
  agent: "c3d4",
  encrypted: true,
  voice: "af_heart",
  ...over,
});

describe("a call's key", () => {
  it("is 32 fresh bytes as base64, the shape strut's voice service takes", () => {
    const a = newCallKey();
    expect(isCallKey(a)).toBe(true);
    expect(Buffer.from(a, "base64")).toHaveLength(32);
    expect(newCallKey()).not.toBe(a);
  });

  it("refuses anything else", () => {
    for (const k of [undefined, "", "abc", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), `${"A".repeat(43)}!`]) {
      expect(isCallKey(k)).toBe(false);
    }
  });
});

describe("readCallAnswer", () => {
  it("takes an encrypted call on a wss:// server, its token for the room named", () => {
    expect(readCallAnswer(answer())).toEqual({
      ok: true,
      answer: { url: "wss://livekit.sphinx.chat", room: ROOM, token: expect.any(String), identity: "a1b2", agent: "c3d4", voice: "af_heart" },
    });
  });

  it("never makes a call in the clear", () => {
    for (const encrypted of [false, undefined, "true"]) {
      const read = readCallAnswer(answer({ encrypted }));
      expect(read.ok).toBe(false);
      expect(!read.ok && read.error).toMatch(/encrypted/);
    }
  });

  it("refuses a token for another room, and an answer it cannot read", () => {
    expect(readCallAnswer(answer({ token: livekitToken(DEV_LIVEKIT, "a1b2", "elsewhere") }))).toEqual({ ok: false, error: "The call’s token is not for the room it named." });
    expect(readCallAnswer(answer({ identity: "has space" })).ok).toBe(false);
    expect(readCallAnswer(answer({ token: 7 })).ok).toBe(false);
    expect(readCallAnswer(null).ok).toBe(false);
  });

  it("refuses a server the browser may not use", () => {
    expect(readCallAnswer(answer({ url: "ws://livekit.sphinx.chat" })).ok).toBe(false);
    expect(readCallAnswer(answer({ url: "ftp://x" })).ok).toBe(false);
  });
});

describe("mediaUrl", () => {
  it("is wss:// anywhere and ws:// only on this machine", () => {
    expect(mediaUrl("wss://livekit.sphinx.chat")).toBe("wss://livekit.sphinx.chat");
    expect(mediaUrl("https://lk.acme.example:7443/rtc")).toBe("wss://lk.acme.example:7443/rtc");
    expect(mediaUrl("ws://127.0.0.1:7880")).toBe("ws://127.0.0.1:7880");
    expect(mediaUrl("http://localhost:7880")).toBe("ws://localhost:7880");
    expect(mediaUrl("ws://livekit.stadeum.localhost")).toBe("ws://livekit.stadeum.localhost");
    expect(mediaUrl("ws://10.0.0.5:7880")).toBeNull();
  });

  it("refuses credentials, a query or a fragment", () => {
    for (const u of ["wss://u:p@lk.example", "wss://lk.example/?token=x", "wss://lk.example/#x", "not a url"]) expect(mediaUrl(u)).toBeNull();
  });
});

describe("tokenRoom", () => {
  it("reads the room a LiveKit token is for", () => {
    expect(tokenRoom(livekitToken(DEV_LIVEKIT, "x", ROOM))).toBe(ROOM);
    expect(tokenRoom("nope")).toBeNull();
    expect(tokenRoom("a.b.c")).toBeNull();
  });
});

describe("refusalMessage", () => {
  it("says a 402's balance and minimum", () => {
    expect(refusalMessage(402, { error: "low", balance: 1200, minimum: 5000 })).toBe("Not enough sats to talk: you have 1,200 sats, and a call needs 5,000.");
    expect(refusalMessage(402, { error: "out of credit" })).toBe("Not enough credit to talk: out of credit");
  });

  it("says a 503 plainly, with the service's words", () => {
    expect(refusalMessage(503, { error: "no voice service is configured" }, "Jamie")).toBe("Jamie can’t take calls right now: no voice service is configured");
    expect(refusalMessage(503, null, "Ada")).toBe("Ada can’t take calls right now.");
  });

  it("keeps the service's words to one short line", () => {
    const said = refusalMessage(400, { error: `bad\nvoice${"x".repeat(400)}` });
    expect(said).not.toContain("\n");
    expect(said.length).toBeLessThan(340);
    expect(refusalMessage(500, {})).toBe("The call couldn’t start (HTTP 500).");
  });
});

describe("the call screen's words", () => {
  it("names the agent's state", () => {
    expect(agentStateLabel(null, "Jamie")).toBe("Waiting for Jamie…");
    expect(agentStateLabel("")).toBe("Getting ready…");
    expect(agentStateLabel("initializing")).toBe("Getting ready…");
    expect(agentStateLabel("listening")).toBe("Listening");
    expect(agentStateLabel("thinking")).toBe("Thinking…");
    expect(agentStateLabel("speaking")).toBe("Speaking");
  });

  it("times a call", () => {
    expect(callDuration(0)).toBe("0:00");
    expect(callDuration(65_400)).toBe("1:05");
    expect(callDuration(3_725_000)).toBe("1:02:05");
  });
});
