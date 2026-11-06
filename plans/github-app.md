# GitHub: one App, repos picked on its installation

> **Status (2026-11-05): a plan, agreed in outline with the owner; nothing
> is built.** Rows in "Decided" marked **agreed** are the owner's; rows
> and sections marked *proposed* are mine and open. This is the roadmap's
> step 7 (`AGENTS.md`, "Where it is going"). Read against stadeum `main`
> @9b84d5c, hive `master` @c692b96bf and strut `main` @7b821eaf. It
> supersedes strut's `plans/org-home-swarm.md` §1.1 and §1.2 for GitHub
> (§10).

## Problem

Strut's code steps clone, push and open pull requests as a person, with
that person's `GITHUB_TOKEN`. Today Hive gets those tokens from its GitHub
App and pushes them to each strut. Hive is being retired, and a Stadeum
box may not call it (rule 9). So a box needs its own way to:

- let an org install a GitHub App and pick which repos it links;
- get each person a token that reaches those repos;
- hand that token to strut as the person's own;
- optionally, sign people in with GitHub.

GitHub fixes an App's callback addresses at registration, but every box
has its own host. That is the hard part, and §3 is the answer.

## Decided

| Question | Decision |
| --- | --- |
| The App | **agreed.** One central GitHub App, "Stadeum", that Stakwork owns. An org installs it and picks which repos to link on GitHub's own install page (the installation has an installation id). No org admin ever creates an app. This is what Hive does today. |
| Token life | **agreed.** Tokens don't expire, as in Hive today: the App's "Expire user authorization tokens" is off. |
| Your own App | **agreed.** Optional: an org that wants more control uses its own GitHub App instead. A self-hosted box can always do this. |
| Callbacks | **agreed (2026-11-05).** Start with GitHub's subdomain matching on the App's callback URLs, so each box under Stakwork's domain gets its own codes directly (§3). Custom domains and self-hosted boxes on the central App come later (§8). |
| Token kind | *proposed.* User-to-server tokens only, as Hive. Nobody holds the App's private key and nobody mints installation tokens (§3). |
| Whose token | *proposed.* One token per person, pushed to strut as their `GITHUB_TOKEN` actor secret. No org-wide token (§5). |
| What is central | *proposed.* The App's registration, plus a bounce at one fixed address that sends an installer back to their box. It holds no secret and stores nothing (§3). |
| App webhooks | *proposed.* Off at first. A box reads what it needs from GitHub when it needs it (§4.5). |
| Sign-in | *proposed.* The same App signs people in, through Auth.js, so signing in also connects (§6). |
| Own App setup | *proposed.* The App Manifest flow, from the box's GitHub page: two clicks on GitHub, then one setting to turn off (§7). |

## 1. What Hive does today

Hive has two GitHub registrations. A classic OAuth App signs people in
(`GITHUB_CLIENT_ID`, scopes `read:user user:email public_repo`,
`src/lib/auth/nextauth.ts:42-55`). A GitHub App gives repo access
(`GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`src/config/env.ts:94-96`). All the paths below are in hive.

- **Install and repo picking.** An org admin starts from Hive. Hive signs a
  `state` that holds the workspace, the user and a timestamp. It is
  HMAC-SHA256 under `NEXTAUTH_SECRET`, valid for an hour
  (`src/lib/auth/github-app-state.ts:36`, `:64-72`). Hive then sends the
  admin to `github.com/apps/<slug>/installations/new?state=…`
  (`src/app/api/github/app/install/route.ts:186-189`). On GitHub the admin
  picks the account and the repos: all, or only some. To change the repos
  later, Hive links to `github.com/apps/<slug>/installations/<id>`
  (`install/route.ts:174-176`).
- **One callback.** The App has "Request user authorization (OAuth) during
  installation" on and a single callback URL
  (`src/app/api/github/app/callback/route.ts:52-54`). So one install also
  authorizes the installer, and GitHub returns `code`, `state`,
  `installation_id` and `setup_action` to that one address. The callback
  checks four things before it does anything else: the signed state, that
  the user is the one who started, and that they administer the workspace
  (`callback/route.ts:96-145`). Then it exchanges the code with the client
  id and secret (`:20-35`). It confirms the installation id against
  `GET /user/installations` with the new token, never trusting the query
  alone (`:181-200`).
- **The installation id.** `SourceControlOrg.githubInstallationId` holds
  it: unique, one row per GitHub account (`prisma/schema.prisma:190-194`).
  It is used for three things:
  - reading the picked repos with a person's token, through
    `GET /user/installations/{id}/repositories` (`src/lib/githubApp.ts:322`,
    `src/app/api/github/app/check/route.ts:25-26`);
  - matching App webhooks to workspaces
    (`src/lib/github/installation-events.ts:38-40`);
  - knowing the App is already installed, so the next member only
    authorizes (`install/route.ts:140-145`, `:177-180`).

  Hive keeps no copy of the repo list.
- **Tokens.** Each person has one `SourceControlToken` per GitHub account
  (`schema.prisma:421-437`). It is a GitHub App user token. It reaches only
  what the App's permissions, the person's own access and the
  installation's repos all allow.
- **"Don't expire" is the App's setting, not Hive's code.** The callback
  stores an expiry only when GitHub sends a refresh token
  (`callback/route.ts:308-314`). Nothing reads that expiry, and nothing
  calls the refresh helper (`githubApp.ts:168`). There is no App private
  key and no installation token anywhere in Hive's `src`.
- **To strut.** Hive pushes the person's App token as their `GITHUB_TOKEN`
  before every job turn (`src/services/strut-jobs.ts:117-120`, `:167`;
  `src/services/strut-actor-secret.ts:53`).
- **Webhooks.** The App's one webhook is checked with
  `GITHUB_WEBHOOK_SECRET`. On installation changes it only pings open setup
  screens. A revoked authorization is logged and nothing else
  (`src/app/api/github/app/webhook/route.ts:13-37`). Repo webhooks are
  separate: Hive creates them with the person's token and points them at
  its own `/api/github/webhook/[workspaceId]`
  (`src/services/github/WebhookService.ts:120-189`).

Stadeum keeps the idea and drops the rest:

- One App does both sign-in and repos, not two registrations.
- One token per person, not one per GitHub account: a user token spans
  every installation the person can reach.
- No refresh code, and no App webhook at first.

## 2. The App

Stakwork registers "Stadeum" under its GitHub org. *Proposed* settings:

- **Callback URLs**, each with wildcard matching on:
  1. `https://<domain>/api/github/callback`. It is first because GitHub
     sends the install-time return to the first callback URL. Each box's
     `https://<label>.<domain>/api/github/callback` matches it.
  2. `https://<domain>/api/auth/callback/github`, for Auth.js sign-in on
     each box (§6).

  `<domain>` is the domain Stakwork runs boxes under, and `<label>` is a
  box's name under it: `HOST=<label>.<domain>`.
- **Expire user authorization tokens: off** (agreed).
- **Request user authorization (OAuth) during installation: on**, as Hive.
  Installing then also authorizes the installer. GitHub then allows no
  Setup URL.
- **Webhook: inactive** (§4.5).
- **Public**, so any org can install it.
- **Repository permissions**, for what strut's steps do today:
  - Contents: read and write, for `git/checkout` and `git/push`;
  - Pull requests: read and write, for `github/create-pr`,
    `github/merge-pr` and `github/fetch-pr`;
  - Checks and Commit statuses: read, for `github/pr-status`;
  - Metadata: read, which every App has.
- **Account permission:** Email addresses, read, for sign-in (§6).
- **No private key.** Generate none, and delete any GitHub made.

Orgs on Hive install Stadeum anew. Tokens belong to one App, so Hive's
tokens don't carry over. They go with Hive's data (strut
`plans/org-home-swarm.md` §5).

## 3. What is central, and what it can reach

Hive is not part of this. Two things are central, and Stakwork runs both:

- **The App's registration on GitHub:** its settings and its client secret.
- **The bounce:** a redirect at `https://<domain>/api/github/callback`, the
  one fixed address an install returns to. It reads the box's label from
  the front of `state`, checks that it is a DNS label, and redirects the
  browser to `https://<label>.<domain>/api/github/callback` with the query
  unchanged. It holds no secret, verifies nothing and stores nothing. A
  Caddy rule does it.

Nothing else is central:

- **No directory.** The state names the box, so nothing maps GitHub
  accounts to hosts. Strut's §1.2 directory is not needed for GitHub.
- **No token kept centrally.** Codes go to the box (one passes through the
  bounce at install), and the box exchanges them.
- **No runtime call.** A box never calls the bounce. Browsers pass through
  it once, at install. If it is down, the install still completes on
  GitHub, and the admin links it from the box with "Already installed"
  (§4.1). That respects rule 9.

**The private key is the line.** Whoever holds an App's private key can
mint an installation token for every org that installed the App. That
token reaches every repo those orgs picked, with no person behind it.
Stadeum has no use for it, so it does not exist (§2). Without it, the App's
reach is what each person could already do.

**The client secret sits on every box Stakwork runs.** It lives in `.env`
and only stadeum-ui reads it. It is never in strut's container, whose
agents run shell commands (rule 4), and never in a browser. With it,
anyone can turn a code into a token, and check, reset or revoke a token
they already hold. The plain consequence:

- **The risk.** Anyone who has the secret, and can get a person to click a
  link, can get that person's token for every org of theirs that
  installed the App. GitHub skips the consent page for someone who already
  authorized the App, and a link can name any `<label>.<domain>`. GitHub
  warns that wildcard matching can carry this kind of risk.
- **What limits it:**
  - `<domain>` serves only boxes Stakwork runs, and has no open redirect;
  - the secret goes only on boxes where Stakwork, and nobody else, has
    root (strut's plan already accepts that Stakwork has root on the boxes
    it hosts);
  - a box exchanges only codes whose state it signed, for the signed-in
    person who started the flow.
- **A leak.** A leak of one box's `.env` leaks the secret for all of them.
  Rotating it means a new value in every box's `.env`. Tokens already
  issued keep working.

A self-hosted box never gets this secret (§8).

**Reach of one App.** A person's user token reaches every org that
installed Stadeum and where that person has access, not only the orgs
their box linked. A box cannot narrow a user token. An org that wants its
people's tokens to reach only its own repos uses its own App (§7).

## 4. The flows (proposed)

`state` is `<label>.<body>.<sig>`:

- `<label>` is the box's first DNS label, in clear for the bounce;
- `<body>` is base64url JSON `{ purpose, userId, nonce, iat }`;
- `<sig>` is HMAC-SHA256 under a key derived from `AUTH_SECRET`.

It lasts an hour, as Hive's state does. A callback refuses a state that is
expired, carries a bad signature, or names a user other than the signed-in
one.

### 4.1 Install and repo picking

1. An admin opens the GitHub page and clicks **Add a GitHub org**. The box
   sends them to `https://github.com/apps/<slug>/installations/new?state=…`.
2. On GitHub they pick the account (an org they own, or themselves) and the
   repos: all, or only some.
3. GitHub authorizes them and returns to the first callback URL with
   `code`, `installation_id`, `setup_action` and `state`. The bounce sends
   that on to the box.
4. The box checks the state and that the person is an admin. It exchanges
   the code for the admin's token. It confirms that `installation_id` is in
   the admin's `GET /user/installations`, because GitHub warns the id can
   be spoofed. It then records the installation, stores the admin's token
   as theirs (§4.3), and pushes it to strut (§5).

A box may link several GitHub orgs.

- **Already installed.** For an App installed outside this flow, or when
  the bounce was down, the page offers **Already installed**. It reads the
  admin's `GET /user/installations` and links the ones they pick, as Hive's
  `findUserInstallationFor` does (`src/lib/github/user-installations.ts:22-36`).
- **Changing repos.** **Change repositories** opens
  `github.com/apps/<slug>/installations/<id>`. The box keeps no copy of the
  repo list. It reads `GET /user/installations/{id}/repositories` with the
  viewer's token each time it shows it. So nothing goes stale, whether or
  not GitHub sends the admin back.
- **A member, not an owner.** If they start the install, GitHub turns it
  into a request to the org's owners. The box sees the installation once
  an owner approves it and someone uses Already installed.

### 4.2 A person connects

On their own page a person clicks **Connect GitHub**. The box sends them to
`https://github.com/login/oauth/authorize?client_id=…&redirect_uri=https://<label>.<domain>/api/github/callback&state=…`.
GitHub matches that redirect by subdomain and returns straight to the box.
The bounce is not involved.

The box then:

- exchanges the code;
- reads `GET /user` for the login and id;
- stores the token and pushes it to strut;
- shows which of the box's linked repos the token reaches.

The first time, GitHub shows a consent page. After that it doesn't.

### 4.3 The token

- **Exchange.** The box exchanges every code itself:
  `POST https://github.com/login/oauth/access_token` with the client id,
  the secret and the code.
- **No refresh.** With expiry off, GitHub sends no refresh token and no
  `expires_in`, so there is no refresh code. A response that does carry
  `refresh_token` means the App's expiry is on. The box then stores
  nothing and tells the admin; this can only happen with an org's own App
  (§7).
- **One token per person.** A new token replaces the old one, and the box
  revokes the old one with `DELETE /applications/{client_id}/token` (basic
  auth with the client id and secret). It revokes that token only, never
  the grant (`/grant`): the grant spans every box the person uses the App
  on.

### 4.4 Keeping tokens true

- **A person disconnects, or an admin removes them.** The box revokes the
  token at GitHub, deletes strut's `GITHUB_TOKEN` for that actor, and
  deletes the row. Removal already deletes the person's delegation the same
  way (`ui/src/app/(app)/members/actions.ts:48-55`).
- **Every six hours**, in the upkeep loop (`ui/src/instrumentation-node.ts`),
  the box checks each token with `POST /applications/{client_id}/token`.
  That uses basic auth and none of the person's rate limit. A token GitHub
  no longer knows (revoked by the person, or the App uninstalled) is
  dropped as above. A live one is pushed to strut again, so a wiped strut
  is put right, as the models are.
- **An installation that was removed** shows as gone on the GitHub page:
  nobody's token sees it any more.

### 4.5 App webhooks

The App's webhook is off. Hive uses its own only to ping open setup
screens, and it ignores revocations (§1). A box learns the same things by
reading GitHub (§4.1, §4.4). If something needs the App's events later,
relaying them is §8.

### 4.6 Repo webhooks

A repo webhook can point anywhere, so it points at the box directly, with
no relay. Strut has no GitHub webhook receiver today. When strut wants repo
events, strut registers the hook with the person's token on its own host,
`strut.<host>`, and verifies it. That is strut's change (rule 1). The App
then needs the repository Webhooks permission, added at that point.

## 5. Whose token strut gets (proposed)

**Per person.** stadeum-ui pushes each person's token with
`PUT /actors/:actor/secrets/GITHUB_TOKEN` and removes it with `DELETE`
(strut `src/createStrut.ts:4915-4944`). stadeum's strut client already has
the push (`pushActorSecret`, `ui/src/lib/strut/client.ts`). Inside a run,
strut resolves the run's principal's value first, then the deployment's,
then env (strut `src/actor-secrets.ts:12-17`). So a change is the
person's:

- `git/checkout` clones with `GITHUB_TOKEN` by default
  (`src/steps/lib/git/checkout.ts:109-116`);
- `git/push` makes the token's owner the commit author
  (`src/steps/lib/git/push.ts:38`);
- `github/create-pr` authors the pull request as them
  (`src/steps/lib/github/create-pr.ts:107`, `:133`);
- `github/merge-pr`, `github/pr-status` and `github/fetch-pr` read it the
  same way.

**No org token.** An org token would be an installation token, minted
every hour with the App's private key (§3). A run with no person gets the
deployment's `GITHUB_TOKEN` if an admin set one in strut's Secrets.
Stadeum sets none.

**No repo list for strut.** A job takes its repos in its input (strut
`src/workflows/job.yaml:20`), and a step reaches what the token reaches. If
strut wants to offer a person their repos, it reads them from GitHub with
that person's token, which is strut's change. Stadeum keeps no list and
pushes none (rules 1 and 3).

## 6. Sign in with GitHub (proposed)

Auth.js's GitHub provider takes the same App's client id and secret; a
GitHub App signs people in through the same web flow. Its callback,
`https://<label>.<domain>/api/auth/callback/github`, matches the second
registered callback URL by subdomain.

- **Email.** Stadeum admits people by a verified email (`admit` and
  `emailFrom`, `ui/src/auth.ts`). The App needs the Email addresses
  permission. The box takes only the primary, verified address from
  `GET /user/emails`, and checks `verified` itself, as it checks Google's
  `email_verified`.
- **Signing in connects.** The sign-in's token is a user token for the
  App, so the box stores it as the person's token (§4.3) and pushes it to
  strut. People who sign in with Google or Microsoft connect on their page
  (§4.2).
- **When it shows.** The provider shows when an App is configured, as
  Google's does when `AUTH_GOOGLE_ID` is set.

## 7. Your own App (agreed; the setup is proposed)

The GitHub page offers **Use your own GitHub App**. Here is how it works:

1. The admin names the GitHub org that will own the App.
2. The box posts a manifest to
   `https://github.com/organizations/<org>/settings/apps/new?state=…`.
   The manifest sets:
   - `url` and `redirect_url` (`https://<host>/api/github/manifest`);
   - `callback_urls`: `https://<host>/api/github/callback` and
     `https://<host>/api/auth/callback/github`;
   - `public: false` and `request_oauth_on_install: true`;
   - the permissions of §2;
   - `hook_attributes` with `active: false`.
3. The admin confirms on GitHub. GitHub returns to the box with a `code`.
   Within the hour, the box calls `POST /app-manifests/{code}/conversions`
   and gets the App's id, slug, client id, client secret, webhook secret
   and private key (`pem`).
4. The box keeps the id, slug, client id, owner and client secret, the
   secret encrypted (rule 4). It drops the private key and the webhook
   secret: it mints no installation tokens and takes no App webhooks. An
   admin can make a new key on GitHub if a later step ever needs one.
5. No manifest field turns off token expiry. The page links to the App's
   settings (Optional features, User-to-server token expiration, Opt out)
   and says that until then the box refuses tokens (§4.3).

Everything then runs as §4, against the org's own App:

- The callbacks name the box's host exactly, with no wildcard and no
  bounce: the install-time return comes straight back.
- A self-hosted box needs nothing central at all.
- When the box's host changes, the App's callback URLs must be edited on
  GitHub. The page says so, as it does for Google and Microsoft.

**Switching.** The GitHub page has one choice: **Stadeum's App** (offered
only when `GITHUB_APP_CLIENT_ID` is set) or **Your own App**. Switching:

- revokes every person's token on the old App;
- deletes their `GITHUB_TOKEN` in strut;
- forgets the linked installations;
- asks people to connect again.

Going back to Stadeum's App deletes the own App's row. The App stays on
GitHub for the admin to delete.

## 8. Later: custom domains, self-hosted boxes, App events

The central App's callbacks match only `<label>.<domain>`. A box at a
custom domain (roadmap step 6), or a self-hosted box, cannot receive its
codes. This is needed, but not first.

- **A custom domain on a box Stakwork runs.** The box keeps its
  `<label>.<domain>` name beside the custom one, and the GitHub flows run
  on that name. The box signs a short-lived ticket for the person and
  sends them to `https://<label>.<domain>/api/github/start?ticket=…`,
  which starts the flow there. The callback lands there, stores the token
  and returns to the custom domain. Nothing central changes. Sign-in with
  GitHub on a custom domain needs the same hop for Auth.js, which is the
  harder half (open question 7).
- **A self-hosted box** uses its own App (§7). That always works.
  Stakwork's App on a self-hosted box would need what strut's §1.1
  sketched:
  - a relay at a fixed callback that forwards to registered hosts, which
    is a directory;
  - and the code exchange done centrally, because a self-hosted box cannot
    hold the secret.

  That puts a central service in every sign-in on such a box, and hands
  tokens to machines Stakwork doesn't run. *Proposed:* build it only if an
  org asks.
- **App events.** If something needs the App's webhook, the bounce can
  learn installation id → label as installs pass through it, and a relay
  can forward by that. The App has one webhook secret. If every box held
  it, any box could forge events to another, so the relay would have to
  sign what it forwards per box. Decide that when the need is real.

## 9. Where it lives in Stadeum (proposed)

stadeum-ui owns all of it (rule 1). ops, Caddy, bootstrap and the compose
file don't change.

- **`ui/src/lib/github/`** holds every GitHub call:
  - `app.ts`: which App (the own App from the database, else Stadeum's
    from env);
  - `state.ts`;
  - `oauth.ts`: authorize URL, exchange, check, revoke;
  - `installations.ts`: verify, list repos;
  - `tokens.ts`: store, replace, push to strut, drop;
  - `manifest.ts`, in the own-App step.

  Strut is still reached only through `ui/src/lib/strut/`, which gains
  `deleteActorSecret` (rule 3).
- **Routes:** `ui/src/app/api/github/callback/route.ts` (install and
  connect) and `ui/src/app/api/github/manifest/route.ts` (the own-App
  step). Sign-in uses Auth.js's own `/api/auth/callback/github`.
- **Pages:**
  - a GitHub admin page, `ui/src/app/(app)/github/`: which App, the linked
    orgs and their repos, Add a GitHub org, Already installed, Change
    repositories;
  - the person's page, `(app)/me`: Connect GitHub, connected as `@login`,
    Disconnect.
- **`stadeum.db`**, in the backup with the rest (rule 8). Secrets are
  AES-256-GCM under `STADEUM_ENCRYPTION_KEY`, as `lib/crypto.ts` does
  (rule 4).
  - `GithubToken`, one per person: `userId` (cascade), `githubId`,
    `login`, `tokenEnc`, `clientId` (the App that issued it), `status`,
    `checkedAt`, `error`.
  - `GithubInstallation`, one per linked org: `installationId`, `account`,
    `accountType` (org or user), `addedById`, `createdAt`.
  - `GithubApp`, one row, only for an own App: `appId`, `slug`,
    `clientId`, `clientSecretEnc`, `owner`, `createdAt`.

  Rule 6's list of what the database holds gains these three. The step's
  PR says so in `AGENTS.md`.
- **Strut's copy.** Each person's token is also in strut's
  `actor-secrets.json`, encrypted under `STRUT_SECRET_KEY`, which is in
  strut's backed-up data. A restore brings back both copies; the upkeep
  check (§4.4) drops any that were revoked meanwhile.
- **`.env.example`** gains one block, blank by default. Blank works: there
  is no Stadeum App, and an admin can still set up the org's own (rule 10).
  `init-env.sh` generates none of these values. No setting names the
  domain: the redirect is `AUTH_URL` plus the path, and the label is
  `HOST`'s first label.

  ```
  # --- GitHub (plans/github-app.md) ---
  # Stadeum's GitHub App, set by Stakwork on the boxes it runs under its
  # domain. Blank: no Stadeum App; an admin can still use the org's own
  # App on the GitHub page.
  GITHUB_APP_SLUG=
  GITHUB_APP_CLIENT_ID=
  GITHUB_APP_CLIENT_SECRET=
  ```
- **Checks.** `npm run fake-stack` gains a fake GitHub with these routes:
  authorize, `access_token`, `/user`, `/user/emails`, `/user/installations`
  and its repositories, `/applications/:id/token` and the manifest
  conversion. The flows are then tested end to end without GitHub.

## 10. What this changes in strut's `plans/org-home-swarm.md` §1.1–1.2

| Strut's §1.1–1.2 said | Now |
| --- | --- |
| GitHub takes up to ten callback URLs, with no wildcards, so per-box hosts can't be registered | GitHub matches subdomains for a callback URL that has wildcard matching on. A box under `<domain>` gets its own codes (§3). |
| Callbacks go through a relay, which checks the host in `state` against the directory | Only the install return passes through the bounce, which reads the box's label from `state`. There is no directory. A person's authorization returns straight to the box (§4.2). |
| The App's webhook is forwarded to the right box | Off at first; a box reads GitHub (§4.5). Relaying is §8, if ever. |
| Repo webhooks point at the box directly | Stands. They are strut's, when it wants them (§4.6). |
| Boxes Stakwork runs hold the client secret | Stands, with the limits of §3. |
| For self-hosted boxes the relay does the exchange and the refresh | *Proposed* instead: a self-hosted box uses its own App (§7). The relay stays open (§8). There is no refresh (§4.3). |
| §1.2: a directory, GitHub org → box host | Not needed for GitHub. It stays open in strut's plan for Peel's pairing. |
| Sign-in through a separate OAuth App, as Hive does | One App for sign-in and repos (§6). |

## 11. Steps

Each is its own PR unless it says otherwise.

0. This plan.
1. **The App and the bounce** (Stakwork, outside this repo). Register
   "Stadeum" with §2's settings, and serve the bounce at
   `https://<domain>/api/github/callback`. Both are written down in
   `docs/github.md` in step 2.
2. **Connect GitHub on Stadeum's App**:
   - `ui/src/lib/github/`, the callback route, the GitHub page and the
     person's page;
   - pushing and deleting strut's `GITHUB_TOKEN`;
   - revoking tokens on disconnect and removal;
   - the six-hourly check;
   - the Prisma migration and `.env.example`;
   - the fake GitHub;
   - `docs/github.md` and `AGENTS.md`'s rule 6.
3. **Sign in with GitHub**: the Auth.js provider on the same App, the
   verified email, and the sign-in token stored as the person's.
4. **Your own App**: the manifest flow, `GithubApp`, switching, and
   Auth.js reading its config at request time (NextAuth's lazy form), so
   sign-in can use an App kept in the database.
5. **Custom domains**, with roadmap step 6: the hop through the box's
   `<label>.<domain>` name (§8).
6. **Only if asked**: Stadeum's App on self-hosted boxes, and relayed App
   events (§8).

## Open questions

1. **The domain.** Which domain do Stakwork's boxes live under, and is
   every box's `HOST` exactly one label below it? Strut's `strut.$HOST` is
   two labels below, but it takes no callbacks.
2. **Root on Stakwork's boxes.** Does an org ever get root, or a shell on
   the host, of a box Stakwork runs? If so, the client secret can't sit
   there (§3), and the exchange moves to a small central service. That
   service needs GitHub to tie each code to the `redirect_uri` it was
   issued for, so a box can exchange only its own codes. GitHub's docs
   don't say that the exchange enforces this.
3. **Wildcard details.** GitHub's docs don't say whether wildcard matching
   covers nested subdomains, or what its default is for an App registered
   now. Check both when registering.
4. **What the install return carries.** GitHub's docs don't say that
   `state` and `setup_action` come back on the install-time return. Hive
   relies on `state` there (`callback/route.ts:76-103`), so they do in
   practice. Does GitHub also come back after Change repositories?
5. **A cap on tokens.** GitHub caps how many live tokens one person holds
   for one classic OAuth App, revoking the oldest. Does a cap apply to a
   GitHub App's user tokens? It matters for a person on many boxes. One
   token per person per box (§4.3) keeps each box to one.
6. **Permissions.** Copy the Hive App's permissions, or the narrower list
   of §2? Does strut push changes under `.github/workflows`? That needs
   the Workflows permission.
7. **Sign-in on a custom domain.** How does Auth.js's GitHub sign-in hop
   through the box's `<label>.<domain>` name (§8)?
8. **An own App with expiry left on.** Refuse its tokens (proposed), or
   support refresh? Refresh means 8-hour tokens, a refresh loop, and a
   push to strut after each refresh.
9. **Reach.** Should strut be told which installations the box linked, so
   a person's work stays in the org's own repos (§3, reach of one App)?
10. **The bounce.** Where does its config live, beside what else that
    Stakwork runs on `<domain>`?
11. **Two boxes, one GitHub org.** An installation is per App per account,
    so two boxes on one GitHub org share one installation and its choice
    of repos. Is that fine, or is it a reason for an own App?
