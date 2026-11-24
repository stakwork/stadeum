# Gmail: a person's mail, for Jamie and for their own workflows

> **Status (2026-11-23): proposed.** Nothing is built. Revised the same
> day, after rulings 5 to 7: building blocks in place of one feature.
>
> - **The goal (Evan, 2026-11-23):** "letting Jamie send and receive email
>   as you". Three uses came up: "help me respond to things", email as a
>   way to reach Jamie ("i can send an email and get a pod link, pr etc
>   back"), and a person's own workflows on their mail.
> - **Read against:** stadeum `main` @8f734a7, strut `main` @07101d4b, and
>   Google's documentation as it read on 2026-11-23. §13 lists what was
>   checked and what was not.
> - **The Rulings** are Evan's. **The decisions in §10** are this plan's
>   defaults; Evan may overrule them.
> - **Companion to:**
>   - `plans/software.md` §2, the connect seam, built for GitHub, with a
>     Google row and a refresh route planned; and §5 item 8, secrets that
>     refresh themselves;
>   - strut `plans/support-ai.md`: Support's reply turn, the shape the
>     reply workflow copies;
>   - `plans/jamie-in-slack.md`: the other integration planned through
>     the seam.

## Rulings (2026-11-23)

| # | Question | Ruled |
| --- | --- | --- |
| 1 | What it is for first | **"Help me respond to things."** |
| 2 | The reply's shape | **Support's reply turn** (strut `plans/support-ai.md`). Mail arrives, a run gathers what it may read, an agent with no tool that writes answers, and a step keeps a draft or sends |
| 3 | Sending without a click | **Wanted**, as Support's `auto` |
| 4 | Where the logic lives | **In Concept pages, not in workflow YAML.** "That is the generic solution" |
| 5 | One feature, or several | **Building blocks.** Mail steps any workflow can use, and ready-made workflows built from them. Asked: "how can we support all these without building a lot?" |
| 6 | Whose mailbox | **Each person's own,** as their GitHub token is theirs. Never one for the box |
| 7 | A team address | **Later.** "Just make sure its generic enough for now" (§6) |

How a person connects was decided before: the connect seam
(`plans/software.md`, Decided row 4).

## Design in one paragraph

A person connects Google on the box, through the connect seam, and their
token goes to strut as their own, beside their GitHub token. A strut
package, `stadeum/gmail`, ships **mail steps** that any workflow on the
box may use, as whoever runs it: new mail since the last look, read,
search, draft, send. It ships two **ready-made workflows** built from
them. `reply` answers a person's mail, as a draft in Gmail or sent, in
the shape of Support's reply turn. `ask` takes mail a person sends to
themselves to Jamie as a job, and answers in the thread with its links. A
person's own workflow is a third, built the same way. **There is no rules
engine:** strut already runs a workflow on a schedule and hands it where
the last run stopped. How to answer is in Concept pages. Stadeum gains a
Google row and a refresh route. Strut gains secrets that refresh and a
schedule that runs for each person. Neither learns what an email is.

## 1. What is already built

| Gmail needs | Built |
| --- | --- |
| A person connecting a provider | The seam: `/api/connect/:provider`, the confirm page, the callback, the provider table (`ui/src/lib/connect.ts`), with GitHub's entry alone |
| The callback through the bounce | `ui/src/lib/signin-bounce.ts` carries `/api/connect/<provider>/callback` for any provider |
| A token that is the person's | `PUT /actors/:actor/secrets/:name`. A run reads its person's value first (strut `src/actor-secrets.ts`) |
| A package's steps managing the secret it provides | `provides.secrets` and `secrets.own` (strut#789, #790): "Connected as", Disconnect |
| A workflow on a schedule, handed where its last run stopped | Automations, and `last` in a fire's input (strut `docs/automations.md`, "Dynamic inputs"). A person's own runs as them today |
| A package's workflow on a schedule | `schedules:` (strut#791). It fires once, as the workflow's owner (§7) |
| An agent with no built-in tools | `toolFilter: ["none"]` in a workflow's YAML (strut `src/workflows/browser-captcha.yaml`, `orchestrator.yaml`) |
| A page in a prompt | `context/concept` (strut `src/steps/lib/context/concept.ts`) |
| A page a box edited, kept at a release | strut `src/packages/install.ts`: an edited Concept is left as it is |
| An app's own SQLite, with migrations | strut `docs/apps.md`, "An app's own SQLite" |
| The job agent's tools from a package, and the ones that ask first | `job.tools` and `job.approve` (strut `src/packages/format.ts`) |
| Following a package from its repository | The Packages page's From a repository (`plans/software.md` §4) |

**Not built:**

- secrets that refresh themselves (`plans/software.md` §5 item 8), and the
  seam's refresh route. A Google token lasts about an hour, so both come
  first;
- a schedule that runs for each person (§7).

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
admin in their company's Google Cloud project (§10 decision 1). It takes
about ten minutes:

1. Make a project and turn on the Gmail API.
2. Set the consent screen's audience to Internal.
3. Make a web OAuth client with the redirect URL the box shows:
   `redirectUri("google")`, the bounce's on a box that has one.
4. Give the box the client id and secret.

It works for a company on Google Workspace, hosted or not, with nothing
central. It does not work for a personal gmail.com account. That waits
for an app Stakwork gets verified (§12).

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
job:
  tools: [search, read, draft, send]
  approve: [send]
schedules:
  - workflow: reply
    trigger: { every: interval, minutes: 5 }
    each: GOOGLE_TOKEN   # new (§7): once for each person who holds it, as them
  - workflow: ask
    trigger: { every: interval, minutes: 5 }
    each: GOOGLE_TOKEN
```

```
steps/       me, disconnect, new, read, search, draft, send, context, answer
workflows/   reply.yaml, ask.yaml
concepts/    Mail Replies.md, Email.md
apps/gmail/  the app and its SQLite
```

### 4.1 The mail steps

Ordinary steps. Any workflow on the box may use them, and each call acts
on the mailbox of whoever the run is for.

| Step | What it does |
| --- | --- |
| `new { search, since? }` | Mail that matches a Gmail search and came after `since`, oldest first, with where it stopped. With no `since` it returns no mail, only where to start, so a first run never takes a backlog |
| `read { thread }` | A thread's messages |
| `search { query }` | Mail that matches, newest first |
| `draft { thread?, to?, subject?, text }` | A draft, in a thread or new |
| `send { thread?, to?, subject?, text }` | The same, sent |

A message comes as its id, its thread, who it is from and to, its
subject, date and text, the names of its attachments, and two facts the
step works out:

- **`mine`:** this mailbox sent it;
- **`machine`:** a list or a machine sent it. It has a `List-Id` or
  `List-Unsubscribe` header, `Auto-Submitted` other than `no`,
  `Precedence` of `bulk`, `list` or `junk`, or a sender such as
  `no-reply` or `mailer-daemon`.

**A person's own workflow** starts with `new`, on a schedule of their
own, with `since` taken from where its last run stopped. Then it does
whatever its steps say. It runs as its owner, with their token. Strut
needs nothing new for this.

### 4.2 Ready-made: `reply`

Support's `support-reply`, with Gmail's names. It runs for each connected
person, as them, on their own spending cap, with `maxRunCostUsd: 1`.

1. **`new`,** with the person's search: `in:inbox category:primary to:me`
   unless they changed it. Mail marked `machine` is dropped. No search
   and no page loosens that.
2. For each message, **`context`** stands down when the person has
   answered in the thread, or the thread has a newer message. Otherwise it
   gathers:
   - the thread;
   - the last 20 messages between the person and the sender, so the
     reply sounds like the person and knows what was said;
   - `Mail Replies` and every page under it (§5);
   - whether the person has written to this sender before.

   When the mail went to more people than the person, it gathers the
   thread alone.
3. **`agent`,** with `toolFilter: ["none"]`, no `agentTools`, `mcp: false`,
   no session, and a schema of `{ reply?, handoff? }`. Its prompt is the
   pages, then the mail, marked as someone else's words. The YAML holds no
   instructions of its own.
4. **`answer`** stands down as step 2 does. Otherwise:
   - **Draft:** it leaves a draft in Gmail, in the thread, in place of
     one it left there before. The person edits and sends it in Gmail.
   - **Send:** it sends the reply when §4.3 allows it, and leaves a
     draft when it doesn't.
   - **A handoff:** nothing is sent. The thread is listed under Needs
     you with the reason, with the draft if the model wrote one.
   - **Neither:** nothing. Most mail needs no reply.

**The recipient is the step's.** A reply goes to whoever sent the
message, or to its `Reply-To`. The model never names anyone, and it
attaches nothing. `answer` records what it did with each message, so it
never acts on one twice.

### 4.3 Sending without a click

`answer` sends only when all of these hold. They are in the step, and no
page changes them:

1. the person set their replies to Send;
2. the person has written to this sender before. A stranger gets a draft;
3. the mail was to the person alone. A thread with several people gets a
   draft;
4. fewer than three replies have gone out this way in the thread since
   the person last wrote in it themselves;
5. the model handed nothing off.

What makes this safe is §4.2's reading rule: **a reply is written from
what its recipient has already seen, and from the pages the box wrote for
replies.** So the worst a planted email can do is get a wrong reply sent
to its own sender. That is the risk Send accepts. The pages say what to
hand off (money, a contract, a date the person hasn't given), and that
part is guidance, not a wall.

### 4.4 Ready-made: `ask`

Email as a way to reach Jamie.

1. The person sends mail to themselves, at their own address with
   `+jamie` in it.
2. **`new`** finds it. The workflow goes on only for mail marked `mine`:
   the mailbox itself sent it, so it is the person's own words. Mail
   anyone else sends to that address starts nothing.
3. It runs a job with the mail as its brief, as the person, so with
   their GitHub token and their pods.
4. When the job ends, **`send`** answers in the thread with the job's
   reply and its links: a pull request, a pod.

A reply the person sends in that thread continues the same job.

### 4.5 Asked in a chat

The package grants the job agent `search`, `read`, `draft` and `send`,
with `send` in `job.approve`, so a send is a proposal the person accepts.
A page under `Job`, `Email`, says how to use them. "Tell Bob Tuesday
works" is then a job, as any work Jamie starts.

### 4.6 The app, Gmail

Every person's own. It is small, because the drafts are in Gmail.

- **Connect Google,** a link to the seam with the two scopes. Back in the
  app it reads "Connected as ana@example.com", from Gmail with the
  person's own token. **Disconnect** revokes the grant at Google and
  deletes the secret.
- **A row for each ready-made workflow,** on or off. The reply's row
  also holds Draft or Send, and its search.
- **Needs you:** the threads handed to the person, each with the reason.
- **Sent for you:** what went out without a click.

Its SQLite keeps each person's rows, and what `answer` did with each
message. It keeps no mail. A mock-up settles the rest.

## 5. Where the logic lives

Ruling 4.

| What | Where | Who changes it |
| --- | --- | --- |
| How to answer: tone, length, what to hand off, when to say nothing | The `Mail Replies` page, the package's | A release |
| This box's own rules | Pages the box adds under `Mail Replies` | The box's people, or Jamie when asked |
| Which mail a ready-made workflow takes, and whether it is on | Per person, in the app | The person |
| Draft or Send | Per person, in the app | The person |
| Anything else a person wants done with their mail | A workflow of their own, from the mail steps | The person, or Jamie when asked |
| The Gmail calls, who a reply goes to, when one may be sent | The steps | A release |
| The order of the steps | `reply.yaml` and `ask.yaml` | A release |

- **A box adds pages; it never edits the package's.** Strut keeps an
  edit, and then that item stops taking releases: an edited page is left
  as it is, and an edited workflow becomes a fork with the release beside
  it (strut `src/packages/install.ts`). A page of the box's own under
  `Mail Replies` loses nothing.
- **What is on these pages can end up in a reply.** They are written for
  that.

## 6. Kept generic

Ruling 7. Three rules hold in every step and workflow of the package:

1. **A mailbox is whoever's token the run has.** No step takes a person
   or an address to act for. None compares the mailbox's address with the
   address the person signs in to the box with. What the package keeps is
   kept by person, never by address.
2. **The steps describe mail and decide nothing.** Who sent it, whether
   this mailbox sent it, whether a machine did: each is a fact on the
   message. What to do about it is a workflow's.
3. **A workflow takes a message and doesn't care what handed it over.**
   Today a schedule does.

A message's shape names nothing of Gmail's but the search text. So an
Outlook package can hand over the same shape, and the ready-made
workflows and their pages could serve both.

**What a team address needs later,** by these rules:

- **A shared address, such as support@:** nothing to build. It is a
  Google account added to the box as a member, and it connects like
  anyone. Its runs are its own.
- **One address a whole team writes to, each as themselves:** something
  that trusts a sender's address and runs the same workflows as that
  person. It is a host, as `plans/jamie-in-slack.md` is for Slack. It
  adds a way in, and changes no step and no workflow.

**What these rules don't cover:** one person with two mailboxes. The seam
keeps one `GOOGLE_TOKEN` for each person (`plans/software.md` §2.1). A
second mailbox is a second member.

## 7. What strut gains

1. **Secrets that refresh themselves,** as `plans/software.md` §5 item 8
   says. Nothing here adds to it.
2. **A schedule for each person.** A package's schedule may name one of
   the secrets it provides: `each: GOOGLE_TOKEN`. A fire then launches
   one run for each person who holds that secret, as them, on their own
   spending cap. Each person's run is handed where their own last run
   stopped. A person whose last run is still going is skipped, as a fire
   is today.
   - Today a fire runs once, as its workflow's owner (strut
     `docs/automations.md`, "Whom a fire runs as"). A package's step works
     only for its run's person, so one run can't read a second person's
     mail.
   - The secret store lists one person's names, not who holds a name
     (strut `src/actor-secrets.ts`).
   - It names no domain. Calendar, Outlook and a Slack package need the
     same thing.

Nothing else. No webhook route, no host key, no Gmail code.

## 8. What stadeum gains

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
  send as them (§10 decision 9).

No table, no page and no route that knows an email. The package is
followed from the Packages page's From a repository. It is not in the
Software bundle.

## 9. Security

- **A stranger's words are untrusted.** In `reply` they steer one reply,
  to themselves, written from what they had already seen and the box's
  reply pages. The model holds no tool. The step names the recipient.
- **In Draft, the person reads every word before it goes.**
- **`ask` takes only mail the mailbox itself sent.** Text the person
  forwards into it is a stranger's all the same, as a page a job reads
  is.
- **A person's own workflow is theirs to judge.** One that hands a
  stranger's mail to an agent with tools can be steered by that mail. The
  `Email` page says so.
- **The token is the whole mailbox.** It sits in strut's secrets, where an
  agent's shell can read it. `gmail.compose` sends as well as drafts, so
  the token can send whatever the person chose. Draft binds the package,
  not the token.
- **A page under `Mail Replies` steers everyone's replies.** Whoever may
  edit pages on the box may do that. Open: whether these pages should be
  an admin's to change.
- **Loops.** Mail from lists and machines starts no reply (§4.2), and a
  thread is capped (§4.3).
- **A person who leaves.** Their refresh token stays in strut until
  strut's `actor.removed` is built (`plans/software.md` §5 item 4). Until
  then the company's Google admin, or the person, ends the grant at
  Google.

## 10. Decisions (defaults; Evan may overrule)

| # | Question | Default | Why |
| --- | --- | --- | --- |
| 1 | One Google app per box, or one Stakwork app for every box | **One per box, Internal**, made by its admin | It needs no verification and nothing central, and works for a self-hosted box. A Stakwork app needs Google's review and a yearly assessment first (§3) |
| 2 | The sign-in's Google client, or a new one | **A new one** | §3 |
| 3 | Which scopes | **`gmail.readonly` and `gmail.compose`** | The least that reads and drafts. `gmail.modify` would add labels, which nothing here needs |
| 4 | How new mail is noticed | **Looked for every five minutes** | A few minutes is soon enough for mail. Gmail's push needs a Pub/Sub topic, a public route in strut and a check of Google's signed token (§12) |
| 5 | What is on when a person connects | **`reply`, in Draft.** `ask` is off | Drafts are what they connected for, and a draft sends nothing |
| 6 | Who may get a reply without a click | **Someone the person has written to before, who wrote to them alone** | Support answers known workers and never a stranger |
| 7 | What a reply reads | **The thread, the last 20 messages with that sender, and the pages** | What the recipient has already seen. It is Support's ruling 1, turned around |
| 8 | Does a sent reply say Jamie wrote it | **No** | As Support's replies don't. A box that wants a line adds it on its own page |
| 9 | Strut holding the Google token | **Needs Evan's yes.** Accepted as GitHub's was, with the person's or the Google admin's revocation | Rule 4. Without it there is no feature |
| 10 | Attachments | **Named to the model, never read or sent** | Simple first |
| 11 | Where the client id and secret go | **`.env`**, through `install.sh`'s answers | As `CONNECT_GITHUB_*`. An admin page comes later, with Slack's (`plans/jamie-in-slack.md` §11) |
| 12 | Whose mail `ask` takes | **Only mail the mailbox itself sent** | The mailbox proves who wrote it, so nothing has to trust a From address |

## 11. Work items

Each is its own PR against its repo's default branch, never stacked.

| Item | Repo | What | Needs |
| --- | --- | --- | --- |
| 1 | strut | **Secrets that refresh themselves** (`plans/software.md` §5 item 8) | — |
| 2 | stadeum | **Google in the seam** (§2, §8): the entry, the callback's step, the refresh route, the settings, the fake Google, the docs, rule 4's line | 1 released |
| 3 | strut | **A schedule for each person** (§7): `each:` on a package's schedule, and who holds a secret | — |
| 4 | strut-gmail | **Connect and the mail steps** (§4.1): the app's Connect and Disconnect, and `new`, `read`, `search`, `draft`, `send`. A person's own workflow works from here. Its tests stand in for Gmail | 1, 2 |
| 5 | strut-gmail | **`reply`, in Draft** (§4.2): `context`, `answer`, the workflow, the `Mail Replies` page, the app's row and Needs you. Its tests stand in for the model too | 3, 4 |
| 6 | strut-gmail | **Send** (§4.3): the choice in the row, the rules, Sent for you | 5 |
| 7 | strut-gmail | **`ask`** (§4.4): the workflow and its row | 3, 4 |
| 8 | strut-gmail | **Asked in a chat** (§4.5): the job agent's four tools and the `Email` page | 4 |

## 12. Later

- **A team address** (§6): a shared mailbox needs nothing built, and one
  address a team writes to, each as themselves, needs a host.
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
- **Outlook,** with Microsoft's row in the seam (§6).
- **Mail as a source for the dream** (`plans/software.md` §5 item 10).

## 13. Checked, and not

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
- how a step knows the mailbox itself sent a message (`mine`), in a way
  mail from outside can't fake, and that mail to an address with `+jamie`
  arrives;
- a package's workflow running `agent` with `toolFilter: ["none"]`.
  Strut's own workflows do, and no package does yet;
- a package's workflow running a job and waiting for its end (§4.4);
- a package's step reaching its app's SQLite from a scheduled run, and
  reading the pages under a Concept by name.

## 14. Rejected

- **One mailbox for the whole box** (ruling 6). Every token is a
  person's (`plans/software.md`, Decided row 6).
- **A rules engine, or a list of rules in the app** (ruling 5). A
  workflow on a schedule is the rule, and strut has that.
- **A service account that reads every mailbox in the company.** That is
  a box token.
- **A send tool, a mailbox search or `graph/graph-get` in the reply
  agent's hands.** A planted email could name another recipient, or pull
  anything into a reply.
- **The `job` workflow for a stranger's mail.** Its agent has a shell.
- **A chat for every arriving email.** Most mail needs one cheap answer,
  or none.
- **The instructions in the workflow's YAML** (ruling 4). A box that
  changed them would fork the workflow and stop taking releases.
- **Labels in Gmail to mark what was handled.** They need `gmail.modify`.
  The app's SQLite keeps it.
