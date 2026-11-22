# Jamie in Slack: stadeum-ui as the box's Slack host

> **Status (2026-11-22): proposed.** Nothing is built.
>
> - **The goal (Evan, 2026-11-22):** strut's Jamie in a Slack org. People
>   in a company's Slack workspace mention Jamie in a channel or DM it, and
>   the box's orchestrator answers, each turn as the person who asked.
> - **Read against:** stadeum `main` @ca1cebd and strut `main` @134418f6.
> - **The Rulings** are Evan's. **The decisions in §9** are this plan's
>   defaults; Evan may overrule them.
> - **Companion to:**
>   - strut `plans/jamie-in-tribes.md`: the first host of this kind,
>     built. Every behavior below that says "as in tribes" is there;
>   - `plans/software.md` §2: the connect seam, built for GitHub, with a
>     Slack row planned;
>   - strut `plans/people-and-hosts.md`: linked accounts and names.

## Rulings (2026-11-22)

| # | Question | Ruled |
| --- | --- | --- |
| 1 | Who the Slack host is | **Stadeum (stadeum-ui).** "Stadeum is supposed to be the 'identity and integrations' layer (that's it)". It replaces this plan's first sketch, a Slack host of its own beside strut (§12) |

## Design in one paragraph

**stadeum-ui is the box's Slack host.** It plays the part the treasury
daemon plays in tribes (strut `plans/jamie-in-tribes.md` §1), and it
already has what a Slack host needs: public HTTPS routes, the connect seam's OAuth and client
secrets, an encrypted database, a background loop, and who people are. The
box's own Slack app posts each event to stadeum-ui. stadeum-ui launches the
turn through strut's ordinary run API with a `slack` host key, as the
person who spoke, and posts the reply that strut's callback brings back.
The seam does both kinds of linking. A person's connect links their Slack
account to them in strut, and an admin's install keeps the bot's token in
stadeum-ui. Strut gains one generic route, for linking an account on the
deployment key's word. Slack needs no **places**: Slack's own `/invite`
decides where Jamie is, and Slack names every speaker, so a turn never runs
as anyone but the person who spoke.

## 1. What is already built

| A Slack host needs | Built |
| --- | --- |
| A key of its own | strut's `STRUT_HOST_KEYS="sphinx:<a>,slack:<b>"` (strut `src/auth.ts`, `hostKeys`). The name is the kind of account the host vouches for |
| To run a turn as the speaker | `x-strut-account: slack:<key>`. It resolves to the linked person, or `403 not_linked`. `accountKey` takes any kind's key of up to 200 printable characters (strut `src/people.ts`) |
| The speaker's name | `x-strut-account-name` (strut `plans/people-and-hosts.md` §1) |
| Conversations of its own | `host/slack/<12 hex>`, refused to anyone but the `slack` host (`hostLaunchRefusal`, `conversation_hosted:`). The Jamie app shows one read-only, with Continue here |
| Never an admin's turn | A run with `origin: "host"` (strut `plans/jamie-in-tribes.md` ruling 8) |
| Wake replies and their files | The callback of the conversation's latest turn, and `delivered` on a wake turn's `run.end` |
| Recovering a lost `run.end` | `GET /conversations/item` (strut `plans/jamie-in-tribes.md` §6.2) |
| Proposals decided as the person | `POST /proposals/:id/decide` |
| A person connecting a provider | The seam: `/api/connect/:provider`, the confirm page, the callback, the provider table (`ui/src/lib/connect.ts`), with GitHub's entry alone |
| Public routes, secrets kept encrypted, background work | stadeum-ui: Next.js behind Caddy, Prisma on SQLite with `encryptField`, the upkeep loop (`instrumentation-node.ts`) |
| One way to reach strut | stadeum-ui's strut client (rule 3) |

## 2. The box's Slack app

**One Slack app per box**, made by the box's admin from a manifest
(§9 decision 1).

1. **Make it.** The admin opens Slack's create-from-manifest link,
   `https://api.slack.com/apps?new_app=1&manifest_json=<…>`, with the
   manifest filled in for this box (§8). They pick their workspace and
   click Create.
2. **Copy three values** into the box: `CONNECT_SLACK_CLIENT_ID`,
   `CONNECT_SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`, all for
   stadeum-ui alone.
3. **Install it** through the seam: **Add to Slack** on the box (§3.2).

**The manifest:**

- a bot user named Jamie;
- the event request URL `https://<box>/api/slack/events`, with the events
  `app_mention` and `message.im`;
- the interactivity URL `https://<box>/api/slack/interactions`;
- the bot scopes `app_mentions:read`, `chat:write`, `channels:history`,
  `groups:history`, `im:history`, `reactions:write`, `users:read` and
  `files:read`, and the user scope `users:read`;
- the seam's callback as its redirect URL (`redirectUri("slack")`: the
  bounce's on a box that has one, else the box's own).

**Events come over HTTP** (§9 decision 2), to stadeum-ui's public routes.
Each request is checked against `SLACK_SIGNING_SECRET` (Slack's `v0`
signature over the timestamp and the raw body, refused when older than five
minutes). Slack's URL check (`url_verification`) gets its `challenge` back.

## 3. The seam: linking and installing

### 3.1 A person links their Slack account

1. **Where it starts.** Jamie answers a speaker strut doesn't know (`403
   not_linked`) with an ephemeral message that only they see: "Connect your
   Slack account to <box> so Jamie can act as you", with a link to
   `https://<box>/api/connect/slack?return=<…>`.
2. **The seam as built.** The link lands on the confirm page. The person
   must be signed in to the box, so a Slack user who isn't a member of the
   box can't link. Continue goes to Slack's consent page, and Slack comes
   back to the callback.
3. **The callback's new step.** A provider entry may name the **account**
   its token answer proves: a kind, and the paths of its key. Slack's
   `oauth.v2.access` answers `team.id` and `authed_user.id`:

   ```ts
   slack: () => ({
     name: "Slack",
     authorize: "https://slack.com/oauth/v2/authorize",
     token: "https://slack.com/api/oauth.v2.access",
     scopes: ["users:read"],
     scopeParam: "user_scope", // dropped from the seam with the box token (ad69386); Slack brings it back
     secrets: { SLACK_TOKEN: ["authed_user.access_token"] },
     account: { kind: "slack", key: ["team.id", "authed_user.id"] }, // new: joined with "."
   }),
   ```

   After it writes the secrets, the callback asks strut to link the
   account: `PUT /actors/:actor/accounts/slack:T024BE7LD.U024BE7LH`, with
   the deployment key the strut client already uses for
   `PUT /actors/:actor/secrets/:name`. A link strut refuses is a failed
   connect, as a secret it refuses is.
4. **Unlinking.** The Jamie app's Connect panel lists every linked account,
   and Remove calls `account/unlink`, as built. Today it shows only Sphinx
   accounts (§6).

Slack's OAuth proves the Slack account, and the box's session proves the
person. A connect is always a click on the box's own page (the seam's
rule), so a forwarded link can't connect anyone.

### 3.2 An admin installs Jamie

**Add to Slack** is the seam's `install=1` for Slack, and it is an admin's
alone. The confirm page says it installs Jamie in the workspace for the
whole box. Slack's entry gives its install the bot's scopes as `scope`,
beside the person's `user_scope`.

The callback does what a person's connect does for the admin (their
`SLACK_TOKEN`, their link). It also keeps the bot's token (the answer's
top-level `access_token`) with the team and the bot's user id, in
stadeum-ui's database, encrypted (`encryptField`). The token never reaches
strut.

That token is the box's, not a person's: it is Jamie's identity in Slack,
as the treasury's keys are Jamie's in tribes (§9 decision 4). It answers
`plans/software.md` open question 19, how a box gets a Slack bot's token,
for Jamie. A Slack *package* that posts as the bot is still open (§11).

## 4. A mention, end to end

As in tribes (strut `plans/jamie-in-tribes.md` §2), with Slack's names for
things.

1. **Hear.** `POST /api/slack/events`: an `app_mention` in a channel Jamie
   is in, or any message in Jamie's DM. The route checks the signature and
   answers `200` at once, because Slack wants an answer within three
   seconds. The work runs after the answer (Next's `after()`). An event
   Slack sends again (the same `event_id`) is dropped.
2. **Who.** `slack:<team>.<user>`, where the team is the speaker's own
   workspace (`user_team` in a channel shared with another company). A
   `403 not_linked` gets the connect prompt (§3.1) and no turn. A speaker
   from another workspace is told that Jamie here answers this workspace's
   people, with no link: the box's app can't authorize them.
3. **Which conversation.** The Slack thread. stadeum-ui keeps
   `<channel>/<thread_ts>` → `host/slack/<12 hex>`. A top-level mention
   starts a new conversation, and Jamie answers in a thread under it. A
   mention inside a thread continues that thread's conversation. In the DM,
   each top-level message is a new conversation, and its thread continues
   it.
4. **Busy.** As in tribes: a conversation is busy from its launch to its
   `run.end`. Mentions that arrive meanwhile are held and folded into the
   next turn (`earlier`).
5. **Launch.** `POST /workflows/orchestrator/run` with the `slack` host key,
   `x-strut-account` and `x-strut-account-name` (the speaker's Slack
   display name), `wake: true`, and a `callback` on stadeum-ui over the
   stack's network:
   `http://stadeum-ui:3000/api/slack/end?m=<event id>&token=<…>`. The token
   is an HMAC of the event id under a key derived from `AUTH_SECRET`, as
   the seam's state is, so it needs no setting of its own. The input:
   - `prompt`: `"<name>: <text>"`, one line per folded message;
   - `context.line`: in Slack, the channel and workspace, who asked, that
     everyone in the channel reads the reply, and to keep it short;
     `context.where`: the same, without who asked;
   - `attachments`: `recent.txt` (the thread's messages before the
     mention; for a top-level mention, the channel's last 20), and the
     message's own files, within strut's ten.
6. **Taken.** A `202` adds an 👀 reaction to the mention. A `5xx` or `429`
   is a retry. Any other `4xx` is refused, with one ephemeral line.

## 5. The reply

As in tribes (strut `plans/jamie-in-tribes.md` §6). `POST /api/slack/end`
takes strut's `run.end` and posts it with `chat.postMessage` in the
mention's thread.

- **`output.text`** becomes Slack's formatting, split when it is long.
  Exactly `[silent]` posts nothing. A failed turn posts one line, and a
  `session_busy:` failure is held.
- **Deliverables:** a link line for each that has an address of its own
  (a pull request), and one link to the conversation in the Jamie app
  (`?input=session=<id>`, as the daemon does).
- **A wake reply** comes to the callback of the conversation's latest turn
  (strut `src/wake.ts` `anchorOf`), so it lands in that thread.
- **A proposal** is a post with **Approve** and **Reject** buttons. A click
  arrives at `POST /api/slack/interactions`. A click by the person the turn
  ran as decides it (`POST /proposals/:id/decide` with the clicker's
  account), and the post is updated to show the outcome. Anyone else who
  clicks gets an ephemeral "<name>'s to decide". Slack names every
  clicker, so this works in every channel. Tribes need `SentBy` for the
  same thing.
- **A lost `run.end`** is recovered from `GET /conversations/item`, as in
  tribes §6.2: a turn with no `run.end` after 10 minutes, read again every
  10 minutes by the upkeep loop.

## 6. What strut gains

1. **`PUT` and `DELETE /actors/:actor/accounts/:account`**, with the
   deployment key alone. These link an account to a person, and remove the
   link, on the word of whoever holds the deployment key. That key can
   already act as anyone, so the routes add no power. They are the generic
   door: the seam uses them for Slack, and GitHub's connect could link
   `github:<id>` the same way later.
2. **The Jamie app:** Connect lists every kind of linked account (its name,
   its kind and Remove), not only Sphinx's (strut's `Connect.tsx` filters on
   `kind === "sphinx"`), and `hostPlace("slack")` reads "Slack".
3. Docs: strut's `specs/API.md` §13 and `docs/security.md`.

Nothing else. Host keys, `host/<name>/` conversations, origin `host`,
callbacks and `delivered` are already generic. Strut has no Slack code.

## 7. What stadeum-ui gains

- **Routes:**
  - `POST /api/slack/events` and `POST /api/slack/interactions`, public and
    checked against `SLACK_SIGNING_SECRET`;
  - `POST /api/slack/end`, strut's callbacks, opened by the per-event token
    alone.
- **The seam** (§3): `account` and `scopeParam` on a provider entry, the
  link step, Slack's entry, and an admin's install that keeps the bot
  token.
- **Its database** (Prisma):
  - the install: the team, the bot's user id and its token, encrypted;
  - each thread's conversation;
  - the turns in flight, with what each answers and whether it is posted.
  This is what the daemon keeps in `strut.json`.
- **The upkeep loop** reads lost `run.end`s every 10 minutes (§5).
- **Settings:** `CONNECT_SLACK_CLIENT_ID`, `CONNECT_SLACK_CLIENT_SECRET`,
  `SLACK_SIGNING_SECRET`, and `STRUT_SLACK_HOST_KEY`, the `slack` host key.
  stadeum-ui uses that key for Slack's turns, never the deployment key it
  also holds (§9 decision 9).

**Rule 1 changes** (Ruling 1, `AGENTS.md`). Today it says Stadeum owns only who
people are, the org's key and the box, and that a change which makes
stadeum know what a workflow, a job, a run or a document is belongs in
strut. A host has to know a little: which conversation a Slack thread is,
and what a `run.end` carries (text, links, proposals). That is about what
the Calls page knows already. Proposed wording: *Stadeum owns who people are
and how they reach strut from outside (sign-in, the connect seam, and hosts
for media like Slack), the org's key and the box. It knows a conversation by
its id and a run by its end, never what a workflow does.* stadeum-ui's row
in the architecture table gains "Jamie in Slack".

## 8. On a Stadeum box

- **strut:** `STRUT_HOST_KEYS` names both hosts. The compose line today
  makes `sphinx:` alone from `STRUT_HOST_KEY`; it becomes
  `${STRUT_HOST_KEY:+sphinx:${STRUT_HOST_KEY},}${STRUT_SLACK_HOST_KEY:+slack:${STRUT_SLACK_HOST_KEY}}`
  (strut skips an empty entry).
- **`init-env.sh`** makes `STRUT_SLACK_HOST_KEY`.
- **`install.sh` and the docs:** print this box's manifest link, with its
  event, interactivity and redirect URLs filled in, and take the three
  values as answers, as `CONNECT_GITHUB_*` are taken (§9 decision 8).
- **No new service.** Jamie in Slack is off until the three values are set
  and an admin clicks Add to Slack.

## 9. Decisions (defaults; Evan may overrule)

| # | Question | Default | Why |
| --- | --- | --- | --- |
| 1 | One Slack app per box, or one Stakwork app for every box | **One per box**, made by its admin from a manifest | Slack sends every workspace's events to one URL per app. A shared app would need a central relay that reads every company's messages, and a fleet table from workspace to box. One per box needs nothing central, and works for a self-hosted box too. It costs the admin about five minutes in Slack |
| 2 | HTTP events or Socket Mode | **HTTP, to stadeum-ui's routes** | stadeum-ui already has public routes and holds secrets; Next.js holds no long-lived socket well. It saves an app-level token |
| 3 | How a Slack account is linked | **The connect seam** (§3.1) | Both sides are proved: Slack's OAuth proves the account, the box's session proves the person |
| 4 | How the box gets the bot's token | **An admin's Add to Slack, through the seam; kept by stadeum-ui, encrypted** | It is Jamie's identity in Slack, held where the client secret already is. Stadeum's "no box token" (`software.md`, Decided row 6) is about tokens strut holds for packages; this one never reaches strut. Alternative: the admin pastes the token Slack's own Install button shows |
| 5 | A speaker who isn't linked | **No turn.** An ephemeral link to connect | Slack names every speaker, so a turn never needs to borrow someone else's access. Alternative: run as whoever invited Jamie to the channel, as tribes run as the linker |
| 6 | Places (strut `plans/jamie-in-tribes.md` §5.4) | **None** | A person tells Slack where Jamie is (`/invite`), and Slack tells the host. Places exist because nobody could reach the daemon |
| 7 | Which messages are turns | **A mention in a channel; every message in Jamie's DM** | As in tribes, a message in a room is a turn only when it is to Jamie: a mention, or a direct reply to Jamie's post (ruled 2026-10-30 and 10-31). A Slack thread has no reply to one post, so a mention it is. A DM is to Jamie already |
| 8 | Where the admin's three values go | **`.env`**, through `install.sh`'s answers | As `CONNECT_GITHUB_*`. Alternative: a Slack admin page in stadeum-ui that keeps them encrypted, so a running box adds Slack without a restart; the seam would read its client from there |
| 9 | Which key Slack's turns use | **The `slack` host key**, not the deployment key | With the host key, strut itself keeps a Slack turn from being an admin's and from leaving `host/slack/`. Every linked account stays in one table, with Peel's. Alternative: the deployment key with `x-strut-actor`, the links kept in stadeum-ui, and no strut change |
| 10 | A person's connect scope | **`users:read`**, which also writes their `SLACK_TOKEN` | The link needs only who they are, so the least a connect can ask: one read-only user scope. A Slack package can use the token later |
| 11 | `recent` | **The thread's messages before the mention; the channel's last 20 for a top-level one** | As tribes send `recent`. It has the same trade-off: what was said goes into a conversation the speaker can read in the Jamie app |

## 10. Work items

Each is its own PR against its repo's default branch, never stacked.

| Item | Repo | What | Needs |
| --- | --- | --- | --- |
| 1 | strut | **Linking by the deployment key** (§6): `PUT` and `DELETE /actors/:actor/accounts/:account`; Connect lists every kind; "Slack" in `hostPlace`; strut's `specs/API.md` and `docs/security.md` | — |
| 2 | stadeum | **The seam links and installs** (§3): `account` and `scopeParam` on an entry, the link step, Slack's entry, the admin's install keeping the bot token, `CONNECT_SLACK_*`; rule 1's new wording (§7) | 1 |
| 3 | stadeum | **Jamie in Slack** (§4, §5, §7, §8): the three routes, the Prisma models, recovery in the upkeep loop, `STRUT_SLACK_HOST_KEY` and both hosts in `STRUT_HOST_KEYS`, `install.sh`'s manifest link and answers, the docs. Its tests stand in for Slack, and for strut's routes as the daemon's do | 2; strut's item 1 released |

## 11. Later

- **A box in several Slack workspaces:** distributing the app, with a bot
  token kept per workspace.
- **A Slack admin page** in stadeum-ui (§9 decision 8).
- **Slack's assistant pane** (Agents & AI Apps): a split view with a
  status line and suggested prompts.
- **Files Jamie makes** uploaded into the thread, instead of a link.
- **Connecting from the Jamie app's Connect panel.** Strut's app would
  need the seam's address.
- **A Slack package** that posts as the bot or as the person (their
  `SLACK_TOKEN`). How a package uses the bot's token is `software.md`'s
  open question 19.

## 12. Rejected

- **A Slack host of its own beside strut** (this plan's first sketch,
  2026-11-22): a new service holding the app over Socket Mode, its code in
  strut's repo. Ruling 1: Stadeum is the identity and integrations layer,
  and stadeum-ui already holds the client secret, the public routes and the
  database such a service would add. The treasury is a program of its own
  only because a Sphinx account has to run as a daemon anyway.
- **One Stakwork Slack app with a central event relay** (§9 decision 1).
- **Socket Mode** (§9 decision 2).
- **Linking by matching emails** (Slack's `users:read.email` against the
  box's sign-in). A Slack workspace's admin sets its people's emails, so a
  link must be proved by the person on the box.
- **The bot token in strut.** stadeum-ui posts with it; strut never needs
  it.
- **A turn as the channel's inviter or the app's installer** for a speaker
  nobody linked (§9 decision 5).
