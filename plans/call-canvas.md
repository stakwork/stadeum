# Recording a call on the canvas: Jamie takes the notes and shows them

> **Status (2026-11-24): proposed.** Nothing is built. Builds on
> `group-calls.md` (proposed, nothing built either): a box's `voice` service
> in an encrypted group call, hearing each person with strut's streaming
> STT. Read against stadeum `main` @38d3df9, stakwork/sphinx-voice `main`
> @96d5998, strut `main` @c7407193, the `stadeum/canvas` package
> (strut-canvas) @bb29cf0, stakwork/peel `main` @22c5902e,
> stakwork/peel-android `main` @80982f4 and stakwork/meet `main` @bbe0e9c.
>
> The canvas app is being worked on at the same time. This plan asks it for
> one view (§6.3) and one Concept page (§3).
>
> **Ruled 2026-11-24 (Evan):** the scribe runs on Sonnet, since it decides
> every card that goes on the canvas; a recording has no budget by default
> (§3).

## Problem

Evan wants (2026-11-24) Jamie in a group call to keep what is said on the
Infinite Canvas, and to show that canvas to the call as a shared screen.

Neither of voice's two modes does it:

- **Meeting mode** (`monitor.ts`) acts only on the wake word. What was said
  around "Jamie" goes through the Haiku gate (`classifier.ts`) and, when it
  is a request, becomes one orchestrator turn carrying an excerpt of the
  call. Between requests, nothing is done with what is said.
- **1:1 mode** (`voice-agent.ts`) is always on: every end of turn is an
  orchestrator turn. Done the same way in a group, that is a turn per
  sentence per person, nearly all of them people talking to each other. A
  conversation runs one turn at a time, so a real request would wait behind
  them.

So the question is when to run the model. Not after every sentence. And a
small model deciding after every sentence whether to run the big one is a
second judgment in front of the one that matters (§2).

## Recommendation

**Two loops.** Requests keep the wake word, as today. Recording is a
second, silent loop: a **scribe**, a job whose turns voice launches with
**chunks** of the call, cut where the room goes quiet. Each turn reads what
was said since the last one and writes to the canvas, or writes nothing.
Jamie **shows the canvas** as a screen share: voice publishes a video track
whose frames come from strut's browser looking at the canvas app.

No model decides when to write. Rules on signals voice already has cut the
chunks (§2). The scribe holds the whole call in its session and decides
what is worth writing, including "nothing yet".

## 1. Two loops

| | Requests | Recording |
|---|---|---|
| Starts on | the wake word, or `@jamie` in the chat | a chunk being cut (§2) |
| Runs | an orchestrator turn on `host/voice/<call>` (group-calls.md §7) | a turn of the call's scribe job (§3) |
| Says | its reply, spoken and in the chat | nothing: the canvas changes |
| At a time | one, as now | one; a chunk cut while a turn runs waits and goes with the next |

The two never wait on each other: the conversation and the job are
separate sessions. A request about the canvas is the one place they meet
(§5).

In a group, "always on" means always recording, not always answering. Jamie
speaking without being asked is not in this plan.

## 2. When a chunk goes

Every line heard goes into the call's transcript, as today
(`TranscriptBuffer`, `transcript.ts`). Voice keeps a cursor: the last line
sent to the scribe. A chunk is every line after it. It goes:

- **At a lull:** nobody has spoken for `LULL_MS` (5 s), by every
  participant's VAD (Silero, which group-calls.md §3 already runs per
  participant), **and** the first waiting line is `CHUNK_MIN_MS` (45 s)
  old or the waiting lines hold `CHUNK_MIN_WORDS` (100) words.
- **At the latest** `CHUNK_MAX_MS` (3 min) after the first waiting line,
  lull or not: a long stretch of talk with no pause.
- **At once** on a request about the canvas (§5).
- **At the end:** when recording stops, or the last person leaves.

Chat lines and Jamie's own lines go in too (a reply may settle something),
each as `[hh:mm] Name: text`, as `formatLine` writes them. No line is sent
twice, as `Excerpts` already promises for requests: the job's session holds
every chunk, so it only grows at the end.

The numbers are starting values. They are tuned by replaying real calls
(work item 1): Hive's calls already upload `call-transcript.jsonl` with each
line's time (sphinx-voice `plans/call-transcript.md`), and the gaps between
lines stand in for lulls.

That makes about a turn a minute while people talk, and none while they do
not: tens of turns for an hour's call.

**The scribe may write nothing.** A chunk often ends in the middle of an
idea, and the scribe is told so: write what was settled, hold back what is
still being worked out. The next chunk comes into the same session, so the
half it held back is still there when the rest arrives. Whether an idea is
finished is the scribe's call, made with everything said so far.

Why not a small model (Haiku) after every sentence:

- It cannot know. Whether an idea is finished depends on what is said next.
  A lull is the free signal that people stopped.
- It is hundreds of calls an hour, nearly all of them answering "not yet".
- It makes the scribe's judgment a second time, with less to go on.

If the scribe's turns cost too much in practice, a cheap first pass can go
in front of it **per chunk** ("anything new worth writing?"). Measure first;
it is not in this plan.

## 3. The scribe is a job

A job of kind **Call Canvas**: a Concept page in the `stadeum/canvas`
package beside Canvas Planning, a child of `Job`, so `job.yaml` puts it at
the head of every turn (strut `docs/jobs.md`, the kind's page). What the
model is told lives on that page, not in voice or in a workflow (strut
AGENTS.md, Core ideas). It says, in its own words:

- You hear a call in chunks, people talking to each other. Write the ideas,
  decisions and questions they settle. Hold back what is still being worked
  out. When nothing new was said, write nothing.
- Write through `canvas` as Canvas Planning does: read first, then a
  `plan`. An open question becomes a brainstorm question, with the options
  people named.
- Name who said it, from the line's speaker. Each person's audio is
  transcribed on its own, so names need no guessing.
- The transcript is noisy: names and product words may be misheard. When a
  word does not fit, prefer the card that already exists.
- Never edit or delete what a person wrote (`canvas` refuses it anyway).

**Its turns.** Voice launches each one as group-calls.md §7 launches a
group turn: the deployment key, with `x-strut-actor` the person who started
the recording.

```
POST /workflows/job/run
{ "input": { "prompt": "<the chunk>", "kind": "Call Canvas" },
  "job": "<an id voice mints for the call>", "title": "<the call's name>" }
```

- **No `wake`.** A launch that does not ask is never woken (strut
  `specs/API.md`, the `wake` field), so a scribe turn's end is never
  spoken.
- **One at a time.** While a turn runs, a new launch is `job_busy:`. Voice
  keeps the chunk and sends it with the next.
- **Sonnet (ruled).** The scribe decides every card that goes on the
  canvas; `canvas` is code that checks and writes what it planned. So voice
  passes `params.model: sonnet` on every scribe turn (aieo's alias,
  `claude-sonnet-5-5` today). On a box a job otherwise runs on the org's
  default (`stack/strut/host-config.json` unpins `job`'s model,
  `docs/models.md`), which may be a cheaper model. A box whose model list
  leaves Sonnet out refuses the turn at the gateway, and the chat says so.
- **No budget (ruled).** A recording takes none by default.

The job gives the rest:

- **The call's memory:** the job's session holds every chunk. History only
  grows at its end, so the prompt cache keeps a turn's cost near its new
  lines.
- **Safe writes:** `canvas` stamps every card `created_by_kind: jamie`.
  Stories and requirements are written `proposed`, for a person to accept
  or drop (`write.ts`). A person can remove any card Jamie wrote, and
  restore it (`op`'s `remove` and `restore`).
- **Live updates:** the job's updates (`job/status`, the graph signal) are
  what the canvas app already reads (`job/updates` and `graph/changes` are
  in its grants).
- **Reach from requests:** voice names the job on a request turn's
  `context.line` ("this call is recorded on the canvas by job <id>"), so
  the orchestrator can read it (`job/read`): "Jamie, what did we decide
  about pricing?"

## 4. Starting and stopping

- **From Peel's call menu:** "Record on the canvas", beside choosing a box
  (group-calls.md §5). Peel says so when it asks the box to join:
  `POST /voice/calls { mode: "group", room, key, record: true }`.
- **By voice:** fixed phrases, matched as the silence commands are
  (`matchSilenceCommand`, `wake-word.ts`): "Jamie, take notes on the
  canvas" starts and "Jamie, stop taking notes" stops. Not the gate:
  sending the whole call to the model should never start on a model's
  guess.
- **Whose turns:** the person who started it, else the call's starter
  (group-calls.md §7).
- **What it is about:** the phrase may name it ("…on the canvas for
  onboarding"). The first chunk carries those words, and the scribe finds
  that initiative or starts one. Otherwise the scribe decides from what is
  said: the initiative the talk is about, else a new one named for the
  call.
- **Everyone is told:** a chat line says recording started, and each joiner
  gets it with the history, as `TRANSCRIPT_NOTICE` is sent today. A
  participant attribute, `recording: true`, lets a client show it.
- **The end:** the last chunk goes and the job stays, with its cards and its
  session. A later call starts a new job. A person can still continue this
  one from the canvas by asking Jamie.

## 5. Requests while recording

The gate (`classifier.ts`) already runs on every wake word. While the call
is recorded it answers one more thing: `{ forward, from, canvas }`, with
`canvas: true` when the request is to put something on the canvas or change
what is there ("Jamie, put that on the canvas", "Jamie, make that a
milestone").

- **`canvas: true`:** voice cuts a chunk at once, the request its last line,
  and starts no orchestrator turn. The scribe acts on it. The chat says
  "On the canvas."
- **Anything else** goes to the orchestrator, as today.

Without this, a canvas request would also reach the orchestrator, which
starts a Canvas Planning job: two writers on one canvas.

## 6. Jamie's screen

### 6.1 The track

Voice publishes a video track with source `SOURCE_SCREENSHARE`, from an
rtc-node `VideoSource` (`captureFrame(VideoFrame)`), on the room it joined
with the call's key, so its frames are encrypted as its audio is. It is
1280×720. Frames come only when the page changes (§6.2), and voice sends
the last one again every second, so a person who joins sees it at once. The
track starts with the recording and stops with it.

The clients need nothing new:

- Peel on iOS gives a remote screen share its own tile and focuses one that
  just started (`IOSCallSession.swift`, `refocus`). Jamie's screen is a
  screen tile, not Jamie's (`isJamie: !screen && jamie`).
- Peel on Android shows the first screen share as the big tile
  (`CallSession.kt`, `screenTile`).
- meet's layout renders `Track.Source.ScreenShare`
  (`app/custom/layout/CustomVideoLayout.tsx`).

### 6.2 The frames: strut's browser looking at the app

Every box runs `strut-browser`, on a network only strut joins
(`stack/stadeum.yml`). Strut already opens an app in it as a person, with
nothing to sign in: `lookAtApp` (strut `src/browser/service.ts`, the
`app/look` step) loads strut's UI from `https://strut.invalid` and answers
every request in-process, as the run's actor. The browser holds no
credential and needs no address for strut.

New in strut: **a look that streams.** `GET /apps/look/stream?app=<name>&input=<deep link>`,
a WebSocket, as the person. It opens the app as `lookAtApp` does, keeps it
open while the socket is, and sends its frames as JPEG from Chrome's
screencast (`Page.startScreencast` through Playwright's CDP session), which
sends a frame only when the page paints. Voice decodes each frame and
captures it. An open stream counts against `BROWSER_SESSIONS_MAX` (4), and
its idle timer does not run while the socket is open.

It is not the canvas's: any app can be shown in a call this way.

### 6.3 What the canvas shows

Nobody moves the mouse on Jamie's screen, so the app needs a **presenter
view**. Opened with the job (`present: <job>` in its deep link), it follows
that job: it moves to each card as it is written and marks the new ones,
from `job/updates` and `graph/changes`, which the app is already granted.
This is the one thing this plan asks of the canvas app.

### 6.4 Why a video, not the app in every client

In a group call, the key is the only thing that says who is in it. People
who joined through meet, or who are linked to another box, cannot open this
box's app. A video shows the canvas to exactly the people who can hear the
call, and to no one else. Anyone linked to the box can still open the real
canvas from its link in the chat (sphinx-voice `plans/call-artifacts.md`).

## 7. What leaves the box (amends group-calls.md §6)

group-calls.md §6 says only the gate's window and a request's excerpt reach
the box's model. While a call is recorded, **everything said** reaches it,
a chunk at a time. It is still the box's model, as for every strut turn,
and a box on a private provider keeps it private. §6 and the notice (§4)
must say so.

## Work items

| # | Repo | What | Needs |
|---|---|---|---|
| 1 | sphinx-voice | The chunker (§2): the cursor, the lull from every participant's VAD, the thresholds as env, a cut on a canvas request and at the end; a script that replays Hive `call-transcript.jsonl` files through it and reports the chunks an hour | group-calls.md item 1 |
| 2 | sphinx-voice | Recording (§3, §4, §5): `record` on `POST /calls`, the start and stop phrases, the job's turns (`job_busy:` → the next chunk), the notice and the `recording` attribute, the job on a request turn's `context.line`, the gate's `canvas` answer | 1 |
| 3 | sphinx-voice | The screen (§6.1): the video track from strut's stream, the last frame again each second; `scripts/e2ee-call.ts` with the track, and a meet browser that decodes it | 4 |
| 4 | strut | `GET /apps/look/stream` (§6.2): a kept `lookAtApp` page and its screencast as JPEG frames on the socket; `specs/API.md`, `docs/browser.md` | — |
| 5 | stadeum/canvas | The Call Canvas page (§3) and the presenter view (§6.3) | — |
| 6 | peel, peel-android | "Record on the canvas" in the call menu, sent as `record: true` | 2 |
| 7 | stadeum | `group-calls.md` §6 amended (§7); docs with the release that carries 2 and 4 | 2, 4 |

## Open

- **1:1 calls.** The same chunker could record a 1:1 call. Not in this
  plan.

## Rejected

- **Every sentence an orchestrator turn**, as 1:1 calls do (Problem).
- **A small model after every sentence** deciding when the scribe runs
  (§2).
- **The orchestrator's conversation as the scribe.** Its turns are spoken,
  and one at a time: a request would wait behind a scribe turn.
- **A workflow of the canvas package's own, run per chunk,** in place of a
  job. It would need its own session and its own way for a request to find
  it. The job has both, and its kind's page is where its instructions
  belong.
- **The gate deciding when recording starts.** Sending the whole call to a
  model starts only on a fixed phrase or Peel's menu (§4).
- **The canvas app opened in each client** in place of a video (§6.4).
- **A browser in voice's own image.** Every box already runs one, and strut
  already opens apps in it as a person (§6.2).
