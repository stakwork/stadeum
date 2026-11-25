# Group calls: Jamie from a box in anyone's call, end to end encrypted

> **Built 2026-11-24** for strut and the voice service: strut#881 (the
> `/voice/calls` routes) and sphinx-voice#45–#47, released in 0.44 and on
> `stable`; checked end to end against a local LiveKit through strut's
> routes. Open: Peel (stakwork/peel#608 for iOS and Mac; Android under
> way) and meet (work item 4). What the build found: the silence pad is
> 2.4 s, not the 1 s below (Kroko decodes in 1.28 s chunks, and a 1 s pad
> lost phrases), with `rule2` at 0.8 s; a ticket is refused for a room the
> box is not in (§7); a caption's speaker is its `lk.transcribed_track_id`,
> not the text stream's sender.
>
> **Status (2026-11-21): proposed.** Nothing was built then. Read against stadeum
> `main` @ce48190, stakwork/sphinx-voice `main` @96d5998, strut `main`
> @bfb0746b, stakwork/peel `main` @6b80cda8, stakwork/peel-android `main`
> @ede0f2d and stakwork/meet `main` @bbe0e9c.
> Companion to strut `plans/jamie-in-tribes.md` (built): this is the same
> idea for calls, where that plan was for tribe messages.
>
> **Revised the same day** after a check against the code: meeting mode's
> captions are not covered by LiveKit's encryption, meet encrypts only
> the media, the streaming recognizer finalizes only on silence it is fed,
> and nothing downloaded the model (§3, §5). **Ruled 2026-11-21 (Evan):**
> a group call's turn may be an admin's, for now: it runs as 1:1 calls'
> do, and an admin starting a job from a call is fine (§7).
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
  `https://<call server>/rooms/<room>#<key>`. meet's room page joins with
  it (`app/rooms/[roomName]/PageClientImpl.tsx`: `ExternalE2EEKeyProvider`,
  the passphrase from `location.hash`). A fragment is never sent to the
  server.
- **meet encrypts only the media today.** It is on `livekit-client` 2.8.1
  and joins with the deprecated `e2ee` option, which leaves the data
  channel in the clear: what a meet participant types in the call's chat
  would cross the server readable, and meet cannot read what the others
  send encrypted (Jamie's replies, the captions, the history). meet joins
  with `encryption` before a box's call is offered (§5, work item 4).
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
  names, identities, participant attributes). LiveKit's encryption covers
  media and, under `encryption`, only these data packets: user data, chat,
  RPC and text streams. Anything else a client sends on the data channel
  is readable by the server (the captions, §3).
- **Only a box on the central LiveKit** can join: a Peel call is on the
  call server's LiveKit, and a box's is a setting (`LIVEKIT_URL`, AGENTS.md
  "Any cloud"). Peel offers a box only when they match (§5).
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

**When Silero says they stopped, voice pads the silence itself.** The
recognizer ends a phrase only on silence it is fed (the endpoint rules,
strut `src/audio/stt.ts`: `rule2`, 1 s after speech by default), and
`/audio/stream` flushes only on `{"type":"end"}`, which closes it. Fed
speech alone, a request's last words would wait for that person's next
ones. So voice sets the rules in its `start` message and, at the end of
each stretch of speech, sends that much silence at once, as `end` pads it:
the recognizer decodes it as fast as it arrives, the final comes back at
once, and the stream stays open. The measurement below fed each clip whole, pauses included, so it
never met this.

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

**The voice service loads the model when it starts:** it opens a stream
and sends half a second of silence, again with backoff until one answers.
That downloads the model on a box that lacks it, as strut's `warmSpeech`
(`src/voice.ts`) does for the batch recognizer and Kokoro, which 1:1 calls
use. Until then the service says group calls are not ready, and Peel's
call menu leaves the box out (§5), so no call waits on a download.

### Speaking

Kokoro through `POST /audio/speak`, as 1:1 calls do (`strut/tts-plugin.ts`,
a sentence per request). Jamie sounds the same alone and in a group. On an
encrypted call the track is published without DTX and without Opus RED, as
1:1 mode publishes it; meeting mode's speaker (`tts.ts`) sets neither today.

### Captions

**Meeting mode's captions are not encrypted today.** `transcriber.ts`
publishes them with `publishTranscription`, LiveKit's old transcription
packet, which its encryption does not cover (§2): on an encrypted call
every word would still cross the server readable. On a box's call the
live text goes on `lk.transcription` text streams instead, as 1:1 mode's
does: the room is connected with `encryption`, never the deprecated
`e2ee`, so the text is encrypted with the media. Hive's calls keep the old
packet; they are not encrypted anyway.

meet shows captions from the old packet only (`RoomEvent.TranscriptionReceived`
in `PageClientImpl.tsx`), so it reads the text streams too (work item 4).

## 4. sphinx-voice: one backend switch

Meeting mode's live parts (`monitor.ts`: the wake word, the gate,
`transcript.ts`'s excerpts, the reply loop, silence and stop) know Hive
only through `src/hive.ts`. Put the four calls they make behind an
interface:

```ts
interface CallBackend {
  turn(req: TurnRequest): Promise<TurnAnswer>;   // 202 / busy / error
  messages(since, wait, opts): Promise<MessagesPage>;  // replies, proposals, errors; with requests, for a late joiner's history
  cancel(): Promise<void>;
  transcript(upload): Promise<boolean>;          // the call's transcript at its end, when asked for
}
```

- **Hive's** is `hive.ts`, unchanged.
- **Strut's** is built from what 1:1 mode already has: `strut/client.ts`
  (an orchestrator turn plus its SSE) and `strut/callbacks.ts` (a job's
  `run.end`). The turn's request and reply, and later a job's end, go onto
  an in-process queue that `messages` reads, so `replies.ts` is unchanged
  and someone who joins late is sent the history (`sendHistory`).
  `transcript` does nothing: this plan records no box call. Keeping one in
  the call's conversation is a later choice.

Beside it, with a box's backend:

- **STT:** a streaming STT plugin over `/audio/stream` in place of
  Deepgram's, padding silence after speech (§3); `transcriber.ts` takes
  either, and publishes on `lk.transcription` with it (§3, Captions).
- **TTS:** `StrutTTS` in place of Deepgram Aura, published without DTX or
  RED (§3).
- **The gate** (`classifier.ts`) runs through the box's strut,
  `POST /steps/llm/run`, with the box's model, not voice's own Anthropic
  key (§6).

The 1:1 process gains a group session beside its member sessions: one per
room, joined with the call's key, closed when the last person leaves.
Meeting mode's parts need no worker for it: `transcribeRoom`,
`createSpeaker` and `createMonitor` each take a `Room`, and `agent.ts`
adds only the job's id (for the transcript) and its shutdown callbacks.

## 5. Starting a call

1. **strut** (stakwork/strut): `POST /voice/calls { mode: "group", room,
   key }` as the person, forwarded to the `voice` service as `/calls`
   already is (`src/voice.ts`: the body as it came, so `mode` needs
   nothing new in strut). The service checks the room is Peel's
   (`sphinx.call.` and a name, as `CallLink.isRoom`) and the key is 32
   bytes as base64, joins the room with the key, and answers
   `{ agent, encrypted: true }`. Refused when the box already has Jamie in
   that room. `GET /voice/calls` is new, forwarded to the service's
   `GET /calls` the same way: `{ group, livekit }`, `group` true once the
   streaming model answers (§3), `livekit` the server the box joins.
2. **Peel** (stakwork/peel, stakwork/peel-android): the chat's call menu
   lists each linked box with `group` true and `livekit` the call
   server's (§2), beside Hive's orgs, as the tribes Jamie row does
   (peel#586). Choosing a box makes a random room (`CallLink.new`) and a
   key, asks the box to join, then posts the link with the key after `#`
   and joins encrypted. If the box fails, nothing is posted; Peel says
   why, as it does for Hive. Needs:
   - `CallLink` to accept a link with a fragment, and keep it as the key
     (`Call.swift:120` and peel-android's `CallLink.kt:91` refuse any
     fragment today);
   - Peel's group call to join with the key as Talk does
     (`TalkSession.options(key:)`, peel-android's `Talk.kt`
     `BaseKeyProvider.setSharedKey`: no DTX, no RED), and say so when the
     encryption fails rather than join in the clear.
3. **Others** join through meet or Peel with the link as posted. meet
   first needs `livekit-client` new enough for data encryption, its room
   page joined with `encryption` instead of `e2ee`, and captions read
   from `lk.transcription` text streams (§2, §3; work item 4).

**The box joins first,** before the link is posted, so its token makes
the room. That matters because meet's tokens send the central `jamie`
worker into any room they make (`app/api/connection-details/route.ts`,
the token's room configuration, which LiveKit applies only to a room it
creates). If everyone leaves and the room closes, a later join through
meet makes a new room with the central worker in it and no box Jamie;
it cannot decrypt the call, so it hears nothing.

## 6. What still leaves the box

The room's audio never does. Of its text, only this does: a request,
and a recording (below).

- **The gate** sees the last 20 minutes of the call (`classifier.ts`),
  each time someone says "Jamie".
- **A turn** carries the request and its excerpt (`transcript.ts`, at most
  15 minutes) to the orchestrator.

**While a call is recorded on the canvas** (`call-canvas.md` §7), everything
said reaches the box's model too, a chunk at a time, and everyone in the
call is told. Every finished line is also kept on the box, in the call's
notes job, for the canvas's transcript view (`call-canvas.md` §7, §9).

All of it goes to the box's model, as every strut turn does. A box that uses a
private provider (strut `docs/privacy.md`: Private AI, Maple) keeps them
private too; that is the box's choice, not this plan's.

## 7. Whose turn it is

As Hive does it (hive#5699, the call ticket), and as tribes do (strut
`plans/jamie-in-tribes.md` §3):

- **A linked person** runs as themselves. Peel asks the box for its own
  join ticket (`POST /voice/calls/ticket { room, name }` as the person,
  forwarded to the service as `/calls` is): the service mints the
  LiveKit token under a new identity, `box_<32 hex>`, and records it
  against the person for the call, so a turn from that identity runs as
  them. meet's identities always contain `__` (`<name>__<4 chars>`, from
  a name the caller picks) and the box's never do, so nobody joining
  through meet can take one, as with Hive's `hive_<32 hex>`.
- **Anyone else** runs as the person who started the call.
- The call's conversation is the host's, `host/voice/<call>`, like a
  tribe's (jamie-in-tribes decision 3), since several people speak in it.

**A turn may be an admin's (ruled 2026-11-21, for now).** Voice launches
a group call's turns as it launches 1:1 calls': the deployment key, with
`x-strut-actor` naming the speaker for an identity the service minted,
else the starter. The deployment key may launch on `host/voice/…`, as on
any id. Strut does not know whether that person is an admin
(`adminStanding` is undefined), so what they may do runs, a job included,
and a step only an admin accepts (`approver: "admin"`) makes a card an
admin may accept. Evan: an admin starting a job from a call is fine.

## 8. Stadeum

Nothing new: no service, port, secret or setting. Group calls are on
wherever calls are (LiveKit's pair and `STRUT_VOICE_TOKEN` in `.env`).
Docs: `docs/stack-spec.md` and the `voice` row in AGENTS.md ("a person's
call, or an encrypted group call it is asked into").

## Work items

| # | Repo | What | Needs |
|---|---|---|---|
| 1 | sphinx-voice | `CallBackend` with its four calls; strut's backend (requests kept for history, no transcript); the streaming STT plugin over `/audio/stream`, padding silence after speech; captions on `lk.transcription`; `StrutTTS` without DTX or RED, and the gate through strut in meeting mode; a group session in the 1:1 process, joined on request with the call's key; the model loaded at start and `GET /calls` `{ group, livekit }`; `box_` identities on the ticket, recorded for the call; group turns on `host/voice/<call>` as the speaker or the starter (§3, §4, §5, §7); `scripts/e2ee-call.ts` with a meet browser in the room | 4 for the meet check |
| 2 | strut | `GET /voice/calls` and `POST /voice/calls/ticket`, forwarded to the service as `POST /voice/calls` is (§5, §7) | 1 for an end-to-end test |
| 3 | peel, peel-android | Boxes in the call menu (`group` and the call server's `livekit` only); the key in the link; `CallLink` with a fragment; group calls joined with the key; the box's ticket for the person's own join | 2 |
| 4 | meet | `livekit-client` new enough for data encryption; the room page joined with `encryption`, not `e2ee`; captions from `lk.transcription` text streams (§2, §3) | — |
| 5 | stadeum | Docs only (§8), with the release that carries 1 and 2 | 1, 2 |

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
- **A `flush` message on `/audio/stream`** that ends a phrase without
  closing the stream. Padding silence from voice does the same with no new
  protocol (§3).
- **A group call's turn never an admin's,** as a tribe's is not
  (jamie-in-tribes ruling 8): voice would launch group turns with
  `STRUT_VOICE_TOKEN`, taken by strut as host `voice`, so their runs were
  `origin: "host"`. Not for now (Evan, 2026-11-21): an admin starting a
  job from a call is fine (§7).
