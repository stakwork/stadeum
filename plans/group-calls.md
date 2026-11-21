# Group calls: Jamie from a box in anyone's call

> **Status (2026-11-20): proposed.** Nothing is built. Read against stadeum
> `main` @e950d55, stakwork/sphinx-voice `main` @96d5998, strut `main`
> @3d4dcf73, stakwork/peel `main` @6b80cda8 and stakwork/meet.
> Companion to strut `plans/jamie-in-tribes.md` (built): this is the same
> idea for calls, where that plan was for tribe messages.

## Problem

From Peel, a person starting a call in a chat can bring Jamie from one of
their Hive orgs. Hive makes the call (`POST /api/strut-devices/calls`),
records it, and dispatches the **central** sphinx-voice worker (meeting
mode, `agent.ts`, registered on the central LiveKit as `jamie`) into the
room with a `callKey`. That worker transcribes everyone with Deepgram,
listens for the wake word, and sends each request to Hive's three call
endpoints (`turn`, `messages`, `cancel`). Hive runs the org's strut and
decides whose turn it is from the speaker's LiveKit ticket.

A box has no Hive. Its `voice` service runs sphinx-voice's **1:1 mode**
only (`one-to-one.js`): one person, no wake word, strut's own STT and TTS,
every turn straight to the box's strut as that person. So today a box's
Jamie can only be called alone, from the Calls page or Peel's Talk.

## Recommendation

**The box's own `voice` service joins group calls too.** The central
worker stays as it is, for Hive orgs and meet's plain rooms, until Hive
goes away. It is not extended to boxes.

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
the 2026-11-14 decision already accepted; nothing new is exposed.

## 2. sphinx-voice: one backend switch

Meeting mode's live parts (`monitor.ts`: the wake word, the Haiku gate,
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

The 1:1 process gains a group session beside its member sessions: one per
room, closed when the last person leaves.

## 3. Hearing and speaking: Deepgram

**Decided (Evan, 2026-11-20).** A group call on a box hears and speaks as
meeting mode does today: Deepgram's streaming STT per participant and
Deepgram Aura TTS. Only where a request goes changes (§2).

- **It is no less private.** Group calls are not end-to-end encrypted
  (only Talk is): the central LiveKit already carries their audio in the
  clear, and the central worker already sends it to Deepgram. Hearing on
  the box would keep nothing more to itself.
- **Meeting mode needs streaming.** Deepgram's partial results time the
  pause after a wake word and draw word-by-word captions. Strut's STT is
  not streaming (`strut/stt.ts`), so the wake word would be caught later
  and captions would come once per utterance, at a CPU cost on the box
  that grows with the number of speakers.
- **1:1 calls stay on strut's STT and TTS.** They are end-to-end encrypted,
  and there keeping the audio on the box is what makes them private.

Jamie's voice in a group call is Aura's (`DEEPGRAM_TTS_MODEL`), not the
box's 1:1 voice. Strut's TTS could take its place later; nothing depends
on it.

## 4. Starting a call

1. **strut** (stakwork/strut): `POST /voice/calls { mode: "group", room }`
   as the person, forwarded to the `voice` service as `/calls` already is
   (`src/voice.ts`). The service checks the room name has the call
   prefix, joins it, and answers `{ agent }` (the agent's identity).
   Refused when the box already has Jamie in that room.
2. **Peel** (stakwork/peel, stakwork/peel-android): the chat's call menu
   lists each linked box beside Hive's orgs, as the tribes Jamie row does
   (peel#586). Choosing a box makes an ordinary random room
   (`CallLink.new`), asks the box to join, then posts the call and joins.
   If the box fails, nothing is posted; Peel says why, as it does for
   Hive.
3. **Others** join through meet as for any call. Group calls are not
   end-to-end encrypted (only Talk is), so the box needs no key.

## 5. Whose turn it is

As Hive does it, and as tribes do (strut `plans/jamie-in-tribes.md` §3):

- **A linked person** runs as themselves. Peel asks the box for its own
  join ticket (`POST /voice/calls/ticket { room, name }` as the person):
  the box mints the LiveKit token under an identity it records against
  them, so a turn from that identity runs as them.
- **Anyone else** runs as the person who started the call.
- The call's conversation is the host's, `host/voice/<call>`, like a
  tribe's (jamie-in-tribes decision 3), since several people speak in it.

## 6. Stadeum

No new service or port. One new setting, `DEEPGRAM_API_KEY` in `.env`,
handed to the `voice` service alone. `scripts/install.sh` asks for it as
it asks for LiveKit's pair (`STADEUM_DEEPGRAM_API_KEY`); the central key is
the default, and a box can bring its own. Without it, group calls are off
on that box and 1:1 calls are as before: strut forwards no `mode: "group"`
call and answers that group calls are not configured, so Peel leaves the
box out of the call menu. Docs: `docs/stack-spec.md` and the `voice` row
in AGENTS.md ("a person's call, or a group call it is asked into").

## Work items

| # | Repo | What | Needs |
|---|---|---|---|
| 1 | sphinx-voice | `CallBackend`; strut's backend; a group session in the 1:1 process, joined on request, hearing and speaking with Deepgram as meeting mode does (§3) | — |
| 2 | strut | `mode: "group"` and `/voice/calls/ticket` on `/voice/calls`; the identity → person record; turns as the speaker or the starter on `host/voice/<call>` | 1 for an end-to-end test |
| 3 | peel, peel-android | Boxes in the call menu (only those with group calls on); the box's ticket for the person's own join | 2 |
| 4 | stadeum | `DEEPGRAM_API_KEY` in `.env` and the installer, and the docs (§6), with the release that carries 1 and 2 | 1, 2 |

## Rejected

- **The central worker for boxes too.** See "Recommendation".
- **Strut's own STT for group calls** (Silero and `/audio/transcribe` per
  participant). Rejected 2026-11-20: it keeps nothing private that the
  unencrypted room does not already give away, it is slower to catch the
  wake word and draws captions per utterance, and its cost on the box
  grows with every speaker (§3).
- **A worker per box under its own agent name** (`jamie-<box>`). It works
  with a shared key pair, but every box would need a dispatch from
  something that holds the admin key anyway, and the box already joins
  rooms itself for 1:1 calls.
