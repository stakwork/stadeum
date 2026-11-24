# Gmail: Jamie helps you answer your mail

> **Status (2026-11-23): proposed.** Nothing is built.
>
> - **The goal (Evan, 2026-11-23):** "letting Jamie send and receive email
>   as you". The first use is "help me respond to things".
> - **Read against:** stadeum `main` @8f734a7, strut `main` @07101d4b, and
>   Google's documentation as it read on 2026-11-23. §12 lists what was
>   checked and what was not.
> - **The Rulings** are Evan's. **The decisions in §9** are this plan's
>   defaults; Evan may overrule them.
> - **Companion to:**
>   - `plans/software.md` §2, the connect seam, built for GitHub, with a
>     Google row and a refresh route planned; and §5 item 8, secrets that
>     refresh themselves;
>   - strut `plans/support-ai.md`: Support's reply turn, the shape this
>     plan copies;
>   - `plans/jamie-in-slack.md`: the other integration planned through
>     the seam.

## Rulings (2026-11-23)

| # | Question | Ruled |
| --- | --- | --- |
| 1 | What it is for first | **"Help me respond to things."** Reading and sending when asked in a chat come after |
| 2 | Its shape | **Support's reply turn** (strut `plans/support-ai.md`). Mail arrives, a run gathers what it may read, an agent with no tool that writes answers, and a step keeps a draft or sends |
| 3 | Sending without a click | **Wanted**, as Support's `auto` |
| 4 | Where the logic lives | **In Concept pages, not in workflow YAML.** "That is the generic solution" |

How a person connects was decided before: the connect seam
(`plans/software.md`, Decided row 4).

## Design in one paragraph

A person connects Google on the box, through the connect seam, and their
token goes to strut as their own. A strut package, `stadeum/gmail`, looks
at each connected person's inbox every few minutes, as them. Mail a
person wrote to them starts a **reply run**. A step gathers the thread and
earlier mail with the same sender. An agent with no tools reads it, with
the pages that say how to answer. A step that is not the model's then
leaves a draft in Gmail, in the thread, or sends it when the person
turned that on. **How to answer is in Concept pages.** The workflow is
only the order of the steps, and the steps hold the Gmail calls and the
safety rules. Stadeum gains a Google row and a refresh route. Strut gains
secrets that refresh and a schedule that runs for each person. Neither
learns what an email is.

## 1. What is already built

| Gmail needs | Built |
| --- | --- |
| A person connecting a provider | The seam: `/api/connect/:provider`, the confirm page, the callback, the provider table (`ui/src/lib/connect.ts`), with GitHub's entry alone |
| The callback through the bounce | `ui/src/lib/signin-bounce.ts` carries `/api/connect/<provider>/callback` for any provider |
| A token that is the person's | `PUT /actors/:actor/secrets/:name`. A run reads its person's value first (strut `src/actor-secrets.ts`) |
| A package's steps managing the secret it provides | `provides.secrets` and `secrets.own` (strut#789, #790): "Connected as", Disconnect |
| A package's workflow on a schedule | `schedules:` (strut#791). It fires once, as the workflow's owner (§6) |
| An agent with no built-in tools | `toolFilter: ["none"]` in a workflow's YAML (strut `src/workflows/browser-captcha.yaml`, `orchestrator.yaml`) |
| A page in a prompt | `context/concept` (strut `src/steps/lib/context/concept.ts`) |
| A page a box edited, kept at a release | strut `src/packages/install.ts`: an edited Concept is left as it is |
| An app's own SQLite, with migrations | strut `docs/apps.md`, "An app's own SQLite" |
| One run for one key | `runs.launch { key }` (strut `src/runs.ts`) |
| The job agent's tools from a package, and the ones that ask first | `job.tools` and `job.approve` (strut `src/packages/format.ts`) |
| Following a package from its repository | The Packages page's From a repository (`plans/software.md` §4) |

**Not built:**

- secrets that refresh themselves (`plans/software.md` §5 item 8), and the
  seam's refresh route. A Google token lasts about an hour, so both come
  first;
- a schedule that runs for each person (§6).

## 2. Connecting Google: the seam's row

One entry in the provider table, as `plans/software.md` §2.1 planned it:

```ts
google: () => ({
  name: "Google",
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  secrets: { GOOGLE_TOKEN: ["access_token"] },
  refresh: true, // new: its access tokens expire
}),
```

- **Two scopes.** `gmail.readonly` reads mail and the person's address.
  `gmail.compose` makes drafts and sends. Google has no scope for drafts
  alone.
- **`prompt=consent`** on every connect, so Google sends a refresh token
  each time and not only the first.
- **One `GOOGLE_TOKEN` for every Google package.** With
  `include_granted_scopes`, a later package's connect adds its scopes to
  the same grant. So Disconnect ends the whole grant, for every Google
  package at once.
- **The callback's new step.** For an entry with `refresh`, it hands strut
  the access token with its expiry and the refresh token. Today it hands
  a plain value (`keep`, `ui/src/lib/connect.ts`).
- **The refresh route,** `POST /api/connect/:provider/refresh`, exactly as
  `plans/software.md` §2.1 describes it. Strut alone calls it, with
  `CONNECT_TOKEN`. It keeps and logs nothing.
- **A fake Google** in `npm run fake-stack`, as GitHub has: authorize, the
  token URL, a refresh.

Settings, all for stadeum-ui alone: `CONNECT_GOOGLE_CLIENT_ID` and
`CONNECT_GOOGLE_CLIENT_SECRET`. `CONNECT_TOKEN` is shared with strut,
which also gets `CONNECT_URL`.

## 3. Whose Google app

What Google's pages say (2026-11-23):

- **Both scopes are restricted.** A public app that asks for one must
  pass Google's verification. One that keeps the data on a server must
  also pass a security assessment by an outside assessor, again at least
  every 12 months.
- **An Internal app is exempt:** one owned by a Google Workspace
  organisation and offered only to its own people.
- **An app in testing** is held to 100 people, and each person's grant
  ends after seven days.

**Each box gets its own Google app, marked Internal,** made by the box's
admin in their company's Google Cloud project (§9 decision 1). It takes
about ten minutes:

1. Make a project and turn on the Gmail API.
2. Set the consent screen's audience to Internal.
3. Make a web OAuth client with the redirect URL the box shows:
   `redirectUri("google")`, the bounce's on a box that has one.
4. Give the box the client id and secret.

It works for a company on Google Workspace, hosted or not, with nothing
central. It does not work for a personal gmail.com account. That waits
for an app Stakwork gets verified (§11).

**It is never the sign-in's Google client** (`AUTH_GOOGLE_*`). On a hosted
box that one is Stakwork's, shared through the bounce. Restricted scopes
on it would put every box's sign-in behind Google's review.

## 4. The package: `stadeum/gmail`

A public repository, `stakwork/strut-gmail`, with a `stable` branch a box
follows, as the other packages are (`plans/software.md`, Decided row 19).

```yaml
# strut.yaml
package: stadeum/gmail
version: 0.1.0
requires:
  optional: [GOOGLE_TOKEN]
provides:
  secrets: [GOOGLE_TOKEN]
schedules:
  - workflow: check
    trigger: { every: interval, minutes: 5 }
    each: GOOGLE_TOKEN   # new (§6): once for each person who holds it, as them
```

```
steps/       me, disconnect, check, context, answer
workflows/   check.yaml, reply.yaml
concepts/    Mail Replies.md
apps/gmail/  the app and its SQLite
```

### 4.1 The app, Gmail

Every person's own:

- **Connect Google,** a link to the seam with the two scopes. Back in the
  app it reads "Connected as ana@example.com", from Gmail with the
  person's own token.
- **Disconnect** revokes the grant at Google and deletes the secret.
- **Replies:** Off, Draft or Send. Draft from the moment they connect
  (§9 decision 5).
- **Mail to answer:** a Gmail search, `in:inbox category:primary to:me`
  unless the person changes it.
- **Needs you:** the threads handed to the person, each with the reason.
- **Sent for you:** what went out without a click.

Its SQLite keeps, for each person, the mode, the search and how far
`check` has read. For each thread it keeps what was done: drafted, sent,
handed over or nothing. It keeps no mail.

### 4.2 `check`

Every five minutes, for each connected person, as them (§6):

1. Nothing when their replies are Off.
2. It lists the mail that matches the person's search and came since it
   last looked. The first look only marks where it starts, so connecting
   never answers a backlog.
3. It drops mail from a list or a machine. This rule is the step's, and
   no search or page loosens it:
   - a `List-Id` or `List-Unsubscribe` header;
   - `Auto-Submitted` other than `no`;
   - `Precedence` of `bulk`, `list` or `junk`;
   - a sender such as `no-reply` or `mailer-daemon`.
4. For each message left, it launches `reply { thread, message }` under
   the key `<thread>/<message>`.

### 4.3 A reply run: `reply`

Support's `support-reply`, with Gmail's names. It runs as the person, on
their own spending cap, with `maxRunCostUsd: 1`.

1. **`context { thread, message }`** stands down when the person has
   answered in the thread, or the thread has a newer message. Otherwise it
   gathers:
   - the thread;
   - the last 20 messages between the person and the sender, so the
     reply sounds like the person and knows what was said;
   - `Mail Replies` and every page under it (§5);
   - whether the person has written to this sender before.

   When the mail went to more people than the person, it gathers the
   thread alone.
2. **`agent`,** with `toolFilter: ["none"]`, no `agentTools`, `mcp: false`,
   no session, and a schema of `{ reply?, handoff? }`. Its prompt is the
   pages, then the mail, marked as someone else's words. The YAML holds no
   instructions of its own.
3. **`answer { thread, message, reply?, handoff? }`** stands down as step 1
   does. Otherwise:
   - **Draft:** it leaves a draft in Gmail, in the thread, in place of
     one it left there before. The person edits and sends it in Gmail.
   - **Send:** it sends the reply when §4.4 allows it, and leaves a
     draft when it doesn't.
   - **A handoff:** nothing is sent. The thread is listed under Needs
     you with the reason, with the draft if the model wrote one.
   - **Neither:** nothing. Most mail needs no reply.

**The recipient is the step's.** A reply goes to whoever sent `message`,
or to its `Reply-To`. The model never names anyone, and it attaches
nothing.

### 4.4 Sending without a click

`answer` sends only when all of these hold. They are in the step, and no
page changes them:

1. the person's replies are set to Send;
2. the person has written to this sender before. A stranger gets a draft;
3. the mail was to the person alone. A thread with several people gets a
   draft;
4. fewer than three replies have gone out this way in the thread since
   the person last wrote in it themselves;
5. the model handed nothing off.

What makes this safe is §4.3's reading rule: **a reply is written from
what its recipient has already seen, and from the pages the box wrote for
replies.** So the worst a planted email can do is get a wrong reply sent
to its own sender. That is the risk Send accepts. The pages say what to
hand off (money, a contract, a date the person hasn't given), and that
part is guidance, not a wall.

### 4.5 Asked in a chat

After the reply run works (§10 item 6). The package grants the job agent
`search`, `read`, `draft` and `send`, with `send` in `job.approve`, so a
send is a proposal the person accepts. A page under `Job`, `Email`, says
how to use them. "Tell Bob Tuesday works" is then a job, as any work
Jamie starts.

## 5. Where the logic lives

Ruling 4.

| What | Where | Who changes it |
| --- | --- | --- |
| How to answer: tone, length, what to hand off, when to say nothing | The `Mail Replies` page, the package's | A release |
| This box's own rules | Pages the box adds under `Mail Replies` | The box's people, or Jamie when asked |
| Which mail to answer | A Gmail search, per person, in the app | The person |
| Off, Draft or Send | Per person, in the app | The person |
| The Gmail calls, who a reply goes to, when one may be sent | The steps | A release |
| The order of the steps | `check.yaml` and `reply.yaml` | A release |

- **A box adds pages; it never edits the package's.** Strut keeps an
  edit, and then that item stops taking releases: an edited page is left
  as it is, and an edited workflow becomes a fork with the release beside
  it (strut `src/packages/install.ts`). A page of the box's own under
  `Mail Replies` loses nothing.
- **What is on these pages can end up in a reply.** They are written for
  that.
- **A person builds their own on top.** The package's steps are ordinary
  steps, and any workflow on the box may use them, as whoever runs it.

## 6. What strut gains

1. **Secrets that refresh themselves,** as `plans/software.md` §5 item 8
   says. Nothing here adds to it.
2. **A schedule for each person.** A package's schedule may name one of
   the secrets it provides: `each: GOOGLE_TOKEN`. A fire then launches
   one run for each person who holds that secret, as them, on their own
   spending cap. A person whose last run is still going is skipped, as a
   fire is today.
   - Today a fire runs once, as its workflow's owner (strut
     `docs/automations.md`, "Whom a fire runs as"). A package's step works
     only for its run's person, so one run can't read a second person's
     mail.
   - The secret store lists one person's names, not who holds a name
     (strut `src/actor-secrets.ts`).
   - It names no domain. Calendar, Outlook and a Slack package need the
     same thing.

Nothing else. No webhook route, no host key, no Gmail code.

## 7. What stadeum gains

- **The seam:** Google's entry, `refresh` on an entry, the callback's new
  step, the refresh route (§2).
- **Settings:** `CONNECT_GOOGLE_CLIENT_ID` and `_SECRET` in
  `stack/stadeum.yml` (stadeum-ui's block), `.env.example` and
  `install.sh`'s answers, as `CONNECT_GITHUB_*` are. `init-env.sh` makes
  `CONNECT_TOKEN`. `install.sh` prints Google's redirect URL beside
  GitHub's.
- **Docs:** `docs/stack-spec.md`, "The connect seam".
- **Rule 4 gains a line** (`AGENTS.md`): strut holds each person's Google
  token and its refresh token, so an agent could read a person's mail and
  send as them (§9 decision 9).

No table, no page and no route that knows an email. The package is
followed from the Packages page's From a repository. It is not in the
Software bundle.

## 8. Security

- **The sender's words are untrusted.** They steer one reply, to
  themselves, written from what they had already seen and the box's
  reply pages. The model holds no tool. The step names the recipient.
- **In Draft, the person reads every word before it goes.**
- **The token is the whole mailbox.** It sits in strut's secrets, where an
  agent's shell can read it. `gmail.compose` sends as well as drafts, so
  the token can send whatever mode the person chose. The mode binds the
  package, not the token.
- **A page under `Mail Replies` steers everyone's replies.** Whoever may
  edit pages on the box may do that. Open: whether these pages should be
  an admin's to change.
- **Loops.** Mail from lists and machines starts no run (§4.2), and a
  thread is capped (§4.4).
- **A person who leaves.** Their refresh token stays in strut until
  strut's `actor.removed` is built (`plans/software.md` §5 item 4). Until
  then the company's Google admin, or the person, ends the grant at
  Google.
- **Asked in a chat (§4.5),** mail is read by a job whose agent has a
  shell. `send` asks first. What else a planted email could make that job
  do is the same question as a web page a job reads.

## 9. Decisions (defaults; Evan may overrule)

| # | Question | Default | Why |
| --- | --- | --- | --- |
| 1 | One Google app per box, or one Stakwork app for every box | **One per box, Internal**, made by its admin | It needs no verification and nothing central, and works for a self-hosted box. A Stakwork app needs Google's review and a yearly assessment first (§3) |
| 2 | The sign-in's Google client, or a new one | **A new one** | §3 |
| 3 | Which scopes | **`gmail.readonly` and `gmail.compose`** | The least that reads and drafts. `gmail.modify` would add labels, which nothing here needs |
| 4 | How new mail is noticed | **Looked for every five minutes** | A few minutes is soon enough for mail. Gmail's push needs a Pub/Sub topic, a public route in strut and a check of Google's signed token (§11) |
| 5 | The mode when a person connects | **Draft** | It is what they connected for, and a draft sends nothing |
| 6 | Who may get a reply without a click | **Someone the person has written to before, who wrote to them alone** | Support answers known workers and never a stranger |
| 7 | What a reply reads | **The thread, the last 20 messages with that sender, and the pages** | What the recipient has already seen. It is Support's ruling 1, turned around |
| 8 | Does a sent reply say Jamie wrote it | **No** | As Support's replies don't. A box that wants a line adds it on its own page |
| 9 | Strut holding the Google token | **Needs Evan's yes.** Accepted as GitHub's was, with the person's or the Google admin's revocation | Rule 4. Without it there is no feature |
| 10 | Attachments | **Named to the model, never read or sent** | Simple first |
| 11 | Where the client id and secret go | **`.env`**, through `install.sh`'s answers | As `CONNECT_GITHUB_*`. An admin page comes later, with Slack's (`plans/jamie-in-slack.md` §11) |

## 10. Work items

Each is its own PR against its repo's default branch, never stacked.

| Item | Repo | What | Needs |
| --- | --- | --- | --- |
| 1 | strut | **Secrets that refresh themselves** (`plans/software.md` §5 item 8) | — |
| 2 | stadeum | **Google in the seam** (§2, §7): the entry, the callback's step, the refresh route, the settings, the fake Google, the docs, rule 4's line | 1 released |
| 3 | strut | **A schedule for each person** (§6): `each:` on a package's schedule, and who holds a secret | — |
| 4 | strut-gmail | **Drafts.** The app (Connect, Disconnect, Off and Draft, the search, Needs you), `check`, `reply`, the `Mail Replies` page. Its tests stand in for Gmail and for the model | 1, 2, 3 |
| 5 | strut-gmail | **Send:** the mode, §4.4's rules, Sent for you | 4 |
| 6 | strut-gmail | **Asked in a chat** (§4.5): the four tools and the `Email` page | 4 |

## 11. Later

- **How each person writes.** Notes learned from their sent mail and from
  what they changed in a draft, as Support's notes job learns an app.
  Where a person's own page lives is open: Concept pages are the box's.
- **A handoff that opens a chat** with Jamie about the thread
  (`conversation/start`).
- **Gmail's push** in place of the five-minute look. Google signs each
  delivery with a token of its own, which none of the three schemes
  planned for strut's webhook routes checks.
- **Stakwork's verified app,** for gmail.com accounts and for a hosted box
  with no setup.
- **Attachments** read and sent.
- **Calendar,** a second Google package on the same token, so a reply can
  answer "are you free Tuesday".
- **Outlook,** with Microsoft's row in the seam. The reply workflow and
  its pages name no provider, so they could move to a package both share.
- **Mail as a source for the dream** (`plans/software.md` §5 item 10).

## 12. Checked, and not

**Read in Google's documentation, 2026-11-23:**

- both scopes are restricted, and `gmail.compose` sends as well as
  drafts;
- the Internal exemption, the yearly assessment, and testing's 100
  people and seven days;
- a refresh token comes with `access_type=offline`, and revoking a token
  ends the whole grant;
- Gmail's address for the person is readable with `gmail.readonly`;
- a draft costs 10 quota units, a send 100 and a history read 2, against
  6,000 a minute for one person.

**To check before building:**

- a draft made as a reply inside an existing thread, and the headers it
  needs. The reference page fetched does not say;
- that Google's refresh never sends a new refresh token. Its sample
  answer has none;
- a package's workflow running `agent` with `toolFilter: ["none"]`.
  Strut's own workflows do, and no package does yet;
- a package's step reaching its app's SQLite from a scheduled run, and
  reading the pages under a Concept by name.

## 13. Rejected

- **stadeum-ui as a Gmail host,** as it is Slack's. A host runs a turn as
  whoever spoke. Here the speaker is a stranger, and the mail is the
  person's own data.
- **A send tool, a mailbox search or `graph/graph-get` in the reply
  agent's hands.** A planted email could name another recipient, or pull
  anything into a reply.
- **The `job` workflow for arriving mail.** Its agent has a shell.
- **A chat for every arriving email.** Most mail needs one cheap answer,
  or none.
- **The instructions in the workflow's YAML** (ruling 4). A box that
  changed them would fork the workflow and stop taking releases.
- **A service account that reads every mailbox in the company.** That is
  a box token. Every token is a person's (`plans/software.md`, Decided
  row 6).
- **Labels in Gmail to mark what was handled.** They need `gmail.modify`.
  The app's SQLite keeps it.
