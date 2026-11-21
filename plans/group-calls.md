# Group calls: Jamie from a box in anyone's call, end to end encrypted

> **Status (2026-11-21): proposed.** Nothing is built. Read against stadeum
> `main` @ba14889, stakwork/sphinx-voice `main` @96d5998, strut `main`
> @3d4dcf73, stakwork/peel `main` @6b80cda8 and stakwork/meet.
> Companion to strut `plans/jamie-in-tribes.md` (built): this is the same
> idea for calls, where that plan was for tribe messages.
>
> **Replaces** the first version (stakwork/stadeum#75), which heard and
> spoke with Deepgram because group calls were not encrypted anyway. Evan
> asked for the private version (2026-11-20): every group call with a
> box's Jamie is end-to-end encrypted, and the box hears and speaks with
> strut's own models. A load test on stadeum.stakwork.ai the same day
> showed the box keeps up (§3).

## Problem

From Peel, a person starting a call in a chat can bring Jamie from one of
their Hive orgs. Hive makes the call (`POST /api/strut-devices/calls`),
records it, and dispatches the **central** sphinx-voice worker (meeting
mode, `agent.ts`, registered on the central LiveKit as `jamie`) into the
room with a `callKey`. That worker transcribes everyone with Deepgram,
listens for the wake word, and sends each request to Hive's three call
endpoints (`turn`, `messages`, `cancel`). Hive runs the org's strut and
decides whose turn it is from the speaker's LiveKit ticket. The room is not
encrypted: LiveKit and Deepgram hear every word.

A box has no Hive. Its `voice` service runs sphinx-voice's **1:1 mode**
only (`one-to-one.js`): one person, no wake word, end-to-end encrypted,
strut's own STT and TTS, every turn straight to the box's strut as that
person. So today a box's Jamie can only be called alone, from the Calls
page or Peel's Talk.

## Recommendation

**The box's own `voice` service joins group calls too, encrypted, hearing
and speaking with strut's models.** Nothing said on the call leaves the
people in it and their box, except what a request sends to the box's
model (§6). The central worker stays as it is, for Hive orgs and meet's
plain rooms, until Hive goes away. It is not extended to boxes.

Why not route boxes through the central worker:

- It would hold a credential for every box's strut.
- Everything said on a box's calls would pass through the center and
  Deepgram. A box keeps what is said in its own strut (AGENTS.md, the
  `voice` row).
- Hive is where the speaker is matched to a person today. A box has no
  Hive, so that matching has to move to the box anyway.

## 1. Never a worker on a box

Every box shares the central LiveKit's key pair (AGENTS.md step 8,
decided 2026-11-14). A box that registered an agents-js worker named
`jamie` would be load-balanced with the central one: LiveKit would hand
Hive's and meet's dispatches to the box, and the box's to the center.

So a box joins a room **itself**, with a token it mints (rtc-node `Room`,
no worker), as 1:1 mode already does (`one-to-one.ts`, `calls-route.ts`).
The shared admin key lets it join any room on the server. That is what
the 2026-11-14 decision already accepted, and with every call encrypted a
leaked pair still lets nobody hear one.

## 2. The call's key

LiveKit's shared-key encryption works for any number of people: everyone
holding the key hears the call, and the LiveKit server forwards frames it
cannot read. Each call gets a fresh key, 32 random bytes as base64, made
by the Peel that starts it.

- **It travels in the call's link,** after `#`, as meet already reads it:
  `https://<call server>/rooms/<room>#<key>`. meet's client joins with it
  (`VideoConferenceClientImpl.tsx`: `ExternalE2EEKeyProvider`, the
  passphrase from `location.hash`). A fragment is never sent to the
  server.
- **The key is the string's UTF-8 bytes,** as 1:1 calls already key it
  (sphinx-voice AGENTS.md, "End-to-end encryption"): Peel's
  `BaseKeyProvider(isSharedKey: true, sharedKey:)`, meet's
  `ExternalE2EEKeyProvider.setKey` and rtc-node all derive the AES key from
  those bytes with LiveKit's salt, so the three interoperate. A check
  against a real LiveKit server proves it (`scripts/e2ee-call.ts`, with a
  meet browser added).
- **Who can hear:** whoever can read the chat the call is posted in. That
  is the point: the call is as private as its chat, and the LiveKit
  server, the network and any relay hear nothing.
- **What stays in the clear:** LiveKit's signaling, as for 1:1 calls (room
  names, identities, participant attributes).
- **Old Sphinx apps** cannot join an encrypted call. Peel is the client
  (strut memory, 2026-11-18: Peel only).

## 3. Hearing and speaking: strut's models

### Hearing

Each participant's audio goes to strut's **streaming** STT,
`GET /audio/stream` (strut `src/audio/ws.ts`): a WebSocket, PCM16LE at
16 kHz in, `partial` and `final` text out. Partial results give the wake
word its timing and the captions their word-by-word flow, as Deepgram's
do today. The model is `zipformer-en-kroko` (sherpa-onnx, 57 MB), with no
`partialModel`, the configuration measured below.

A participant's stream stays open while they are in the room, but only
their speech goes into it (Silero): a quiet participant costs no decoding.

**Measured 2026-11-20 on stadeum.stakwork.ai** (from outside, ~265 ms round
trip included; a 69 s English clip per stream, at real time):

| Streams | Partial lag p50 / p95 | Final lag p50 / p95 | Errors |
|---|---|---|---|
| 1 | 0.50 / 1.15 s | 0.73 / 1.00 s | none |
| 3 | 0.50 / 1.15 s | 0.73 / 0.99 s | none |
| 5 | 0.51 / 1.14 s | 0.72 / 1.03 s | none |
| 8 | 0.50 / 1.14 s | 0.72 / 0.99 s | none |

Lag did not grow over a run at any count, and the time to close a stream
after its last audio stayed at ~0.25 s: eight people speaking at once is
well within the box. Not measured: more than eight streams, and the box's
default pairing with a NeMo partial model (not installed there).

The model downloads on a box's first group call if it is not there.
Peel's call menu offers a box only once its strut says the model is
installed (§5), so no call waits on a download.

### Speaking

Kokoro through `POST /audio/speak`, as 1:1 calls do (`strut/tts-plugin.ts`,
a sentence per request). Jamie sounds the same alone and in a group.

### Captions

The live text goes on `lk.transcription`, inside the room's encryption:
the room is connected with `encryption`, never the deprecated `e2ee`, as
1:1 mode does, so the data channel is encrypted too.

## 4. sphinx-voice: one backend switch

Meeting mode's live parts (`monitor.ts`: the wake word, the gate,
`transcript.ts`'s excerpts, the reply loop, silence and stop) know Hive
only through `src/hive.ts`. Put those three calls behind an interface:

```ts
interface CallBackend {
  turn(req: TurnRequest): Promise<TurnAnswer>;   // 202 / busy / error
  messages(since, wait): Promise<MessagesPage>;  // replies, proposals, errors
  cancel(): Promise<void>;
}
```

- **Hive's** is `hive.ts`, unchanged.
- **Strut's** is built from what 1:1 mode already has: `strut/client.ts`
  (an orchestrator turn plus its SSE) and `strut/callbacks.ts` (a job's
  `run.end`). The turn's reply, and later a job's end, go onto an
  in-process queue that `messages` reads, so `replies.ts` is unchanged.

Beside it, with a box's backend:

- **STT:** a streaming STT plugin over `/audio/stream` in place of
  Deepgram's (`transcriber.ts` takes either).
- **TTS:** `StrutTTS` in place of Deepgram Aura.
- **The gate** (`classifier.ts`) runs through the box's strut,
  `POST /steps/llm/run`, with the box's model, not voice's own Anthropic
  key (§6).

The 1:1 process gains a group session beside its member sessions: one per
room, joined with the call's key, closed when the last person leaves.

## 5. Starting a call

1. **strut** (stakwork/strut): `POST /voice/calls { mode: "group", room,
   key }` as the person, forwarded to the `voice` service as `/calls`
   already is (`src/voice.ts`). The service checks the room name has the
   call prefix and the key is 32 bytes as base64, joins the room with the
   key, and answers `{ agent, encrypted: true }`. Refused when the box
   already has Jamie in that room. `GET /voice/calls` (or the answer
   strut already gives for 1:1) says whether group calls are ready: voice
   configured and the STT model installed.
2. **Peel** (stakwork/peel, stakwork/peel-android): the chat's call menu
   lists each linked box with group calls ready, beside Hive's orgs, as
   the tribes Jamie row does (peel#586). Choosing a box makes a random
   room (`CallLink.new`) and a key, asks the box to join, then posts the
   link with the key after `#` and joins encrypted. If the box fails,
   nothing is posted; Peel says why, as it does for Hive. Needs:
   - `CallLink` to accept a link with a fragment, and keep it as the key
     (`Call.swift:120` refuses any fragment today);
   - Peel's group call to join with the key as Talk does
     (`TalkSession.options(key:)`: no DTX, no RED), and say so when the
     encryption fails rather than join in the clear.
3. **Others** join through meet or Peel with the link as posted.

## 6. What still leaves the box

The room's audio and text never do. A request does:

- **The gate** sees the last 20 minutes of the call (`classifier.ts`),
  each time someone says "Jamie".
- **A turn** carries the request and its excerpt (`transcript.ts`, at most
  15 minutes) to the orchestrator.

Both go to the box's model, as every strut turn does. A box that uses a
private provider (strut `docs/privacy.md`: Private AI, Maple) keeps them
private too; that is the box's choice, not this plan's.

## 7. Whose turn it is

As Hive does it, and as tribes do (strut `plans/jamie-in-tribes.md` §3):

- **A linked person** runs as themselves. Peel asks the box for its own
  join ticket (`POST /voice/calls/ticket { room, name }` as the person):
  the box mints the LiveKit token under an identity it records against
  them, so a turn from that identity runs as them.
- **Anyone else** runs as the person who started the call.
- The call's conversation is the host's, `host/voice/<call>`, like a
  tribe's (jamie-in-tribes decision 3), since several people speak in it.

## 8. Stadeum

Nothing new: no service, port, secret or setting. Group calls are on
wherever calls are (LiveKit's pair and `STRUT_VOICE_TOKEN` in `.env`).
Docs: `docs/stack-spec.md` and the `voice` row in AGENTS.md ("a person's
call, or an encrypted group call it is asked into").

## Work items

| # | Repo | What | Needs |
|---|---|---|---|
| 1 | sphinx-voice | `CallBackend`; strut's backend; the streaming STT plugin over `/audio/stream`; `StrutTTS` and the gate through strut in meeting mode; a group session in the 1:1 process, joined on request with the call's key (§3, §4); `scripts/e2ee-call.ts` with a meet browser in the room | — |
| 2 | strut | `mode: "group"` (with `key`) and `/voice/calls/ticket` on `/voice/calls`; whether group calls are ready; the identity → person record; turns as the speaker or the starter on `host/voice/<call>` | 1 for an end-to-end test |
| 3 | peel, peel-android | Boxes in the call menu (only those ready); the key in the link; `CallLink` with a fragment; group calls joined with the key; the box's ticket for the person's own join | 2 |
| 4 | stadeum | Docs only (§8), with the release that carries 1 and 2 | 1, 2 |

## Rejected

- **The central worker for boxes too.** See "Recommendation".
- **Deepgram for group calls** (stakwork/stadeum#75, 2026-11-20). It needed
  the room in the clear, and the box keeps up without it (§3).
- **Strut's batch STT for group calls** (Silero and `/audio/transcribe`
  per utterance). Slower to catch the wake word and captions per
  utterance; the streaming route does both live.
- **A worker per box under its own agent name** (`jamie-<box>`). It works
  with a shared key pair, but every box would need a dispatch from
  something that holds the admin key anyway, and the box already joins
  rooms itself for 1:1 calls.
- **The key in a separate message, or fetched from the box.** The link
  already goes where the call does, and meet already reads its fragment.
