# Software: GitHub, repositories and pods, as packages

> **Status (2026-11-19): a plan.** The owner decided that
> software is a choice each box's admin makes: an admin clicks
> **Software** on the Packages page. Later the same day the owner set the
> direction for how: *"as much as possible … built into the package, and
> as little as possible … into stadeum. I want strut packages to be a VERY
> powerful primitive that can pretty much do everything."* Then the owner
> chose the web flow over the device flow, through a generic connect seam
> in stadeum (§2). The owner approved the GitHub App's settings (§13),
> and chose repository webhooks for real-time updates (§7). The owner
> then asked for the seam to fit more than GitHub: it now covers Slack,
> Google and Microsoft too, with scopes, several tokens and refresh
> (§2.1). It also fits GitLab and Forgejo. For them, a forge's address is
> a setting, strut refreshes expiring tokens, webhooks are checked by
> several signature schemes, and git finds its token by host (§2.1, §5
> items 7-9). Rows marked **owner** in "Decided" are the owner's;
> every other row is *proposed*. Read against stadeum `main` @70d10e0, strut `main`
> @e7663dff, hive `master` @554793fa1, stakwork/pods `main` @2cf4498 and
> stadeum-fleet `main` @6d6f3342. It replaces most of
> `plans/github-app.md` (§11) and `plans/pods.md`'s first-boot
> subscription.
>
> **2026-11-20:** the owner asked how Software catches up with what Hive
> and stakgraph's lab do for code, *"as SIMPLY and ELEGANTLY and
> GENERICALLY as possible"*, not line for line. §14 answers, and all of it
> is *proposed*. It was read against stakgraph `main` @0f7c2297, strut
> `main` @c924062f and stakwork/pods `main` @2cf4498. The owner then
> asked where a repository is set up, with the code graph coming back
> later: in one app, Code, in `stadeum/code`, which now keeps the
> repository list in place of the GitHub package (§3.1, §14.4). That is
> proposed too.
>
> **Built (2026-11-20):** step 2 (§12), the connect seam in stadeum-ui,
> with GitHub's entry and a fake GitHub in `npm run fake-stack`
> (`docs/stack-spec.md`, "The connect seam"). Everything else here is
> still a plan.

## Problem

A box that a software team uses needs three things:

- GitHub access: to clone private repos, to push and open pull requests,
  and to install packages kept in private repos;
- its repositories, known to the box and ingested into its graph;
- a pod for each coding job, with those repositories cloned in.

No box has the first today. `pushActorSecret` exists
(`ui/src/lib/strut/client.ts:144`) and nothing calls it. So pods' `git`
tool can't push or open a pull request (stakwork/pods
`package/steps/git.ts:75-87`), and a `git+` package in a private repo
can't be fetched (strut `src/packages/git-source.ts:28`).

## Decided

| # | Question | Answer | Status |
| --- | --- | --- | --- |
| 1 | Does every box get software? | **No. An admin clicks Software** on the Packages page. | **owner** |
| 2 | Where does it live? | **In packages, as much as possible. Stadeum keeps only generic seams.** | **owner** |
| 3 | The model for GitHub tokens | **Hive's:** GitHub App user tokens that never expire, with no refresh and no private key (§1, §10). | **owner** (Hive's "works great") |
| 4 | How a person connects | **The web flow, through a connect seam in stadeum:** two routes, and a third to refresh tokens that expire, that any OAuth provider's package can use. The client secret stays in stadeum-ui. The token goes to strut as the person's secret. Everything else is the package's (§2). | **owner** (2026-11-19: web flow over device flow); the seam's shape is proposed |
| 5 | Which repositories the box works on | **`stadeum/code` keeps the list,** with its workspaces, in one app, Code. A repository is added by its address, or picked in the GitHub package from what the App's installations grant. `stadeum/code` checks them for new commits and is where the parser plugs in (§3.1, §14.4). | proposed (revised 2026-11-20: the list was the GitHub package's) |
| 6 | Unattended work: ingestion, subscriptions to private packages, a job with no person | **A box token:** a token an admin connects "for the box", kept as strut's deployment `GITHUB_TOKEN` (§3.1). | proposed |
| 7 | A `software` package that requires the others | **No.** Strut pins a required package by digest, and a `git+` subscription doesn't gate a required package on its own secrets (§3.3). Software is a **bundle**, a strut capability to add (§5). Until then, the button makes two subscriptions. | proposed |
| 8 | Repositories and pods: one package or two? | **Two:** `stadeum/github` and `stadeum/pods`. Pods reads the repositories through the graph, not by requiring the package (§3.4). | proposed |
| 9 | Fleet boots a box with Software | **First-boot subscriptions** (`STRUT_SUBSCRIPTIONS`), a strut capability to add, not `STRUT_PACKAGES`, which never moves (§6). | proposed |
| 10 | Real-time updates | **Repository webhooks, straight to each box's strut.** The GitHub package creates one on each repository the box works on, and strut receives it on a webhook route the package declares, a capability to add (§5). Polling stays as the fallback. The App's own webhook is inactive, so nothing central relays events (§7). | **owner** (2026-11-19) |
| 11 | Self-hosted boxes | **Their own App, through the same seam, or a pasted token.** Stakwork's App needs the bounce, so it's for hosted boxes (§8). | proposed |
| 12 | When a box goes | **The package revokes every token it holds,** on a strut event fleet triggers before the machine is destroyed (§9). | proposed |
| 13 | How Software catches up with Hive's code features | **Not a port.** Each feature is mapped onto a part strut already has, and the package ships pages and thin workflows (§14). | **owner** (2026-11-20: the goal); the mapping is proposed |
| 14 | What keeps the Codebase tree | **The dream,** with merged changes as a second source (§14.2). | proposed |
| 15 | Where the code knowledge lives | **A third package, `stadeum/code`,** that names no forge. It keeps the repository list and ships the Code app. Software is github, pods and code (§14.4). | proposed |
| 16 | Logs | **Not Software.** A package for each place logs are kept, `stadeum/aws` first (§14.5). | proposed (the owner's lean, 2026-11-20) |
| 17 | The parsed code graph | **Not at first.** Pages and files. It comes back later, perhaps as a CLI, set up for each repository in the Code app and run in `ingest` (§14.6). | **owner** (2026-11-20: it comes back, and each repository is configurable for it); the rest is proposed |
| 18 | Where a repository is set up | **In one app, Code.** Each other package's part of a repository is a link to its own app at first, and a section drawn in place once strut has panels (§14.4; §5, item 14). | proposed |
| 19 | What a package's repository is called | **`stakwork/strut-<name>`:** `strut-github`, `strut-pods`, `strut-code`, and so on. The package's own name stays `stadeum/<name>`. Pods' package moves from `stakwork/pods-package` to `stakwork/strut-pods` (§11). | **owner** (2026-11-20) |

## 1. What Hive does

`plans/github-app.md` §1 describes Hive's App, and the code agrees with it
(re-read at hive `master` @554793fa1):

- **Two registrations.** A classic OAuth App signs people in, with scopes
  `read:user user:email public_repo` (hive `src/lib/auth/nextauth.ts:51-53`).
  A GitHub App gives repo access (`src/config/env.ts:103-105`).
- **Install and link.** Hive sends an admin to
  `github.com/apps/<slug>/installations/new?state=…`, or to
  `login/oauth/authorize` when the App is already on that account
  (`src/app/api/github/app/install/route.ts:173-192`). The App has
  "Request user authorization (OAuth) during installation" on and one
  callback URL (`callback/route.ts:52-54`).
- **Tokens.** The callback exchanges the code with the client id and
  secret, with no private key (`callback/route.ts:20-46`). It stores an
  expiry only when GitHub sends a refresh token (`:302-314`). GitHub sends
  none when the App's "Expire user authorization tokens" is off. The
  refresh helper has no caller (`src/lib/githubApp.ts:168`).
- **To strut.** Hive pushes the person's App token as their
  `GITHUB_TOKEN` actor secret before every dispatch
  (`src/services/strut-runs.ts:370-376`, `src/services/strut-jobs.ts:176`).

What `plans/github-app.md` §1 doesn't cover:

- **Hive already has a box token, under other names.** Unattended work
  runs as one person:
  - a push webhook triggers ingestion with the **workspace owner's**
    token (`src/app/api/github/webhook/[workspaceId]/route.ts:155-167`);
  - a pod pool clones with **its creator's** token, stored on the pool as
    `github_pat` (`src/app/api/pool-manager/create-pool/route.ts:141`, `:292`).
- **Repositories belong to a workspace:**
  - `Repository` holds `workspaceId`, `repositoryUrl`, `branch` and
    `status` (`prisma/schema.prisma:777-784`);
  - a person adds each one by hand;
  - Hive keeps no copy of what an installation grants, and reads
    `GET /user/installations/{id}/repositories` each time
    (`src/lib/githubApp.ts:322`);
  - a newly granted repository only pings open setup screens, through the
    App's `installation_repositories` event
    (`src/lib/github/installation-events.ts:21-63`).
- **Webhooks, two kinds:**
  - The App's one webhook, checked with `GITHUB_WEBHOOK_SECRET`
    (`src/app/api/github/app/webhook/route.ts:13-23`).
  - Repo webhooks, created per repository with the person's token, for
    `push`, `pull_request`, `deployment_status`, `check_run` and
    `workflow_run` (`src/services/github/WebhookService.ts:26`,
    `:282-295`). Each goes to `GITHUB_WEBHOOK_URL/<workspaceId>`
    (`src/lib/url.ts:15-23`). A push there starts ingestion.
- **Revocation is missing.**
  - "Disconnect" revokes only the sign-in token
    (`src/app/api/auth/revoke-github/route.ts:37-74`).
  - App tokens are never revoked.
  - A revoked authorization is only logged (`app/webhook/route.ts:28-31`).
- **What assumes one central server:**
  - one callback URL;
  - one App webhook URL and secret;
  - one `GITHUB_WEBHOOK_URL` host;
  - `SourceControlOrg.githubLogin` and `githubInstallationId` unique
    across all of Hive (`schema.prisma:193-194`).

  The bounce answers the first (§2). Repository webhooks pointed at each
  box answer the second and third (§7). Hive also finds an installation it didn't make, by reading
  `GET /user/installations` with the person's token and no App key
  (`src/lib/github/user-installations.ts:22-40`). A box needs exactly
  that, because another box may have installed the App on the same
  account.

## 2. What needs stadeum: the connect seam

Only one part of the GitHub link can't be a package's: **trading the
code for a token.** It needs the App's client secret. Every box Stakwork
runs shares that secret, and strut's container runs agents' shell
commands (rule 4), so the secret can't sit there. Everything else is the
package's.

| Part of the link | Who owns it | How |
| --- | --- | --- |
| Starting a connect or an install | **Stadeum's seam** | The package's app sends the person to the seam's start route. Stadeum signs the state, because the callback must trust it |
| The callback and the exchange | **Stadeum's seam** | Through the sign-in bounce, as Google's and Microsoft's sign-in come back today |
| The client secret | **stadeum-ui alone** | In its environment, never in strut's container or a browser |
| Where tokens live | **Strut** | Each person's as their actor secret `GITHUB_TOKEN`, and the box token as the deployment's `GITHUB_TOKEN`. The seam writes them with the calls stadeum has today |
| Handing tokens to steps | **Strut, as built** | A run reads its person's secret first, then the deployment's, then the environment (strut `src/actor-secrets.ts:12-17`). `git/checkout`, `github/create-pr`, pods' `git` and `git+` installs all read `GITHUB_TOKEN`. With other forges, git finds the token by host and strut refreshes one that expires (§5, items 8-9) |
| Installations, repositories, the box token's display, disconnecting, revoking | **The package** | §3.1 |
| Webhooks | **The package, received by strut** | Repository webhooks to the box's own strut (§7). The App's webhook stays inactive |
| Sign in to the box with GitHub | **Stadeum, later** | Identity is stadeum's (rule 1). It would be Auth.js on the same App (`plans/github-app.md` §6), deferred. People sign in with Google, Microsoft or email, and connect GitHub from the package |

### 2.1 The seam

Two routes in stadeum-ui, and a third for providers whose tokens
expire. They name no package, and they work for any OAuth provider in a
small table.

- **`GET /api/connect/:provider`**, with these parameters:
  - `return`: where to send the person afterwards;
  - `scope`: the scopes the package needs, each one listed in the
    provider's entry;
  - `install=1`: start from the provider's install page instead of its
    authorize page;
  - `for=box`: an admin only. The tokens become the box's.

  The person must be signed in. Stadeum signs a state and redirects to
  the provider. The state is `plans/github-app.md` §4's:
  `<label>.<body>.<sig>`, where the body holds the provider, the
  person's actor, `for`, `return`, a nonce and the time. It's HMAC-SHA256
  under a key derived from `AUTH_SECRET`, and it lasts an hour.
- **`GET /api/connect/:provider/callback`**, reached through the bounce.
  It refuses a state that is bad, expired, or names someone other than
  the signed-in person. Then it:
  1. exchanges the code with the provider's token URL, its client id and
     its secret;
  2. writes to strut each secret that the provider's entry names and the
     response holds: `pushActorSecret(actor, name, value)`, or for
     `for=box`, the deployment's `name` (`putDeploymentSetting`,
     `client.ts:208`). A response that holds none of them is a failure.
     That also catches Slack's `ok: false`, which comes with HTTP 200;
  3. redirects to `return`.

  It keeps nothing. On GitHub, installing the App also authorizes the
  installer, and GitHub returns the install to this same callback with a
  code. The seam treats it as a connect and ignores `installation_id`:
  the package reads installations itself.
- **`POST /api/connect/:provider/refresh`**, for a provider whose
  access tokens expire. Refreshing needs the client secret too, so it
  can't be the package's. Its only caller is strut itself, never a
  package's step (§5, item 8).
  - Strut calls it over the stack's network, with `CONNECT_TOKEN` as
    the bearer: a secret strut and stadeum-ui share, as strut and the
    voice service share `STRUT_VOICE_TOKEN`.
  - The body is `{ refresh_token }`. The route posts
    `grant_type=refresh_token`, with the client id and secret, to the
    provider's token URL.
  - It answers `{ access_token, expires_in }`, plus `refresh_token` when
    the provider rotated it. Like the callback, it keeps and logs
    nothing.

  It's built with the first provider whose tokens expire, because
  GitHub's never do (§13 Q3). For such a provider, the callback writes
  the access token as the secret, with its expiry and the refresh token
  beside it. When a step reads the secret near its expiry, strut
  refreshes it and stores the new pair. So:
  - **No reader refreshes.** A package, pods' `git` or a `git+` install
    reads `GITLAB_TOKEN` just as it reads `GITHUB_TOKEN`, and never sees
    a refresh token.
  - **No two runs race.** Strut refreshes one secret at a time.
    Spending a GitLab refresh token invalidates the old pair, so if two
    steps refreshed at once, one would lose and the person would have
    to connect again.

**The provider table,** `ui/src/lib/connect.ts`, is the only part that
names a provider. Each entry is data:

```ts
interface Provider {
  base?: string;                     // a forge's address, from .env: the URLs below are paths under it
  authorize: string;                 // the authorize URL
  install?: string;                  // an install page, if the provider has one
  token: string;                     // the token URL: never from a package
  scopes: string[];                  // every scope a package may ask for
  scopeParam?: { person: string; box: string }; // where scopes go; "scope" for both by default
  params?: Record<string, string>;   // fixed extras on the authorize URL
  secrets: Record<string, string[]>; // each secret's paths in the token response; the first present wins
  refresh?: true;                    // its access tokens expire: strut refreshes them (§5, item 8)
}
```

| Provider | Scopes | Secrets the callback writes | Refresh |
| --- | --- | --- | --- |
| **GitHub** (ships first) | None: the App's settings decide (§13 Q4). `install` is `apps/<slug>/installations/new` | `GITHUB_TOKEN` ← `access_token` | No: expiry is off |
| **Slack** | The bot's as `scope` for the box, a person's as `user_scope` | `SLACK_TOKEN` ← `access_token` (the bot's) or `authed_user.access_token` (the person's) | No: Slack's tokens last unless the app turns rotation on |
| **Google** (Gmail, Drive, Calendar) | `params`: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` | `GOOGLE_TOKEN` ← `access_token` | Yes: an hour |
| **Microsoft** (Outlook, OneDrive, Teams) | `offline_access` and Graph's scopes | `MICROSOFT_TOKEN` ← `access_token` | Yes, and the refresh token rotates on every use |
| **GitLab** (gitlab.com, or a company's own) | `api`, `read_repository`, `write_repository`. `base` is `CONNECT_GITLAB_URL` | `GITLAB_TOKEN` ← `access_token` | Yes: 2 hours. Spending a refresh token invalidates the old pair |
| **Forgejo** (Codeberg, or a company's own) | Its own, if the version honours them (open question 8). `base` is `CONNECT_FORGEJO_URL` | `FORGEJO_TOKEN` ← `access_token` | Yes: an hour by default, with refresh tokens good for 730 hours |

How it fits each of them:

- **One secret name per provider, the person's first, then the box's.**
  Slack's `for=box` installs the bot, so the box token is the bot's, and
  a person who connects acts as themselves, as with `GITHUB_TOKEN`.
- **Google packages share one secret.** With
  `include_granted_scopes`, each Google package's connect adds its
  scopes to what the person granted before. The new token covers them
  all, so one `GOOGLE_TOKEN` serves every Google package.
- **A forge at its own address.** GitLab and Forgejo run at many
  addresses, so their entries take `base` from `.env`. It's still
  stadeum's setting, never a package's.
  - gitlab.com and Codeberg can each have one Stakwork app for every
    hosted box, like the GitHub App.
  - A company's own instance registers an app on that instance, with
    the box's own callback (§8).
  - Two instances of one forge on a box would be two entries. That's for
    later.
- **Settings.** Each entry's values come from `.env`:
  - `CONNECT_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET`;
  - `CONNECT_GITHUB_SLUG`;
  - `CONNECT_GITLAB_URL` (default `https://gitlab.com`) and
    `CONNECT_FORGEJO_URL`;
  - `CONNECT_GITHUB_URL` (default `https://github.com`), only so that
    `npm run fake-stack` can stand in for GitHub: compose never hands it
    to a box.

  A provider is available when its id and secret are set. Google's and
  Microsoft's entries may reuse the sign-in apps (`AUTH_GOOGLE_*`,
  `AUTH_MICROSOFT_ENTRA_ID_*`), with the seam's callback added to their
  redirect URIs.
- **One callback per provider:** `https://auth.stakwork.ai/api/connect/<provider>/callback`
  on hosted boxes.

Adding a provider is one entry and two settings, or three for a forge.

**Not every integration needs the seam.** It's for OAuth providers.
Other integrations need nothing from stadeum: the package stores a
pasted value itself, with §5 item 1. For example:

- a Telegram bot's token from BotFather;
- an IMAP password.

Telegram's login widget sends a payload signed with the bot's token, and
the package checks it itself.

**Four rules keep the seam safe:**

- **The token URL, a forge's address and the scopes are stadeum's, never
  a package's.** If a package could name the token URL or the address,
  it could make stadeum send the secret anywhere. A package asks only for scopes its provider's entry
  lists, and the person sees each one on the provider's consent page.
- **`return` must be on the box's own origins:** `https://<host>` or
  `https://strut.<host>`. So the seam is no open redirect.
- **`for=box` is an admin's.** The route checks the session's role, as
  every admin page does.
- **The refresh route answers strut alone.** Without `CONNECT_TOKEN`
  it refuses. So someone outside who copied a refresh token can't spend
  the box's client secret through it. An agent inside strut's container
  could, but it could already read the tokens themselves (§10).

**Why the web flow over the device flow.** The device flow needs no
secret and no callback, so the package alone could own it. But:

- it only works for GitHub. Slack has no device flow, and Google's needs
  the client secret and allows few scopes. Every future integration
  package (Google Drive, Slack, Linear) needs this seam anyway;
- it costs a typed code per connect;
- anyone can try device-code phishing with a public client id.

It stays an option for a self-hosted box that wants Stakwork's App (§8).

## 3. The packages

### 3.1 `stadeum/github`

A public repository, `stakwork/strut-github`, with the package at its
root and a `stable` branch moved by its promote, as pods does. No service.

```yaml
# strut.yaml
package: stadeum/github
version: 0.1.0
requires:
  # The person's own or the box's: public repositories need neither.
  optional: [GITHUB_TOKEN, GITHUB_HOOK_SECRET]
provides:
  # New (§5): the secrets its steps may delete, and set from an admin's call.
  secrets: [GITHUB_TOKEN, GITHUB_HOOK_SECRET]
  # New (§5): the hosts its token serves, for git anywhere on the box.
  git:
    - { host: github.com, secret: GITHUB_TOKEN }
hooks:
  # New (§5): POST https://strut.<host>/hooks/stadeum/github/events
  - name: events
    workflow: on-event
    signature:
      scheme: hmac-sha256
      header: X-Hub-Signature-256
      prefix: "sha256="
      secret: GITHUB_HOOK_SECRET
```

**Its app, GitHub,** is every person's:

- **Connect GitHub:** a link to `/api/connect/github?return=<this app>`.
  Back in the app, it shows "Connected as @login": its step reads the
  person's own token, never the box's (§5), and calls `GET /user`.
- **Disconnect:** the step sends the token to `POST /credentials/revoke`
  and deletes the person's secret. That endpoint needs no authentication
  and takes GitHub App user tokens. GitHub emails the person that the
  token was revoked.

For an admin, the same app also shows:

- **GitHub orgs:**
  - the installations the admin's token sees;
  - **Add a GitHub org**, a link to
    `/api/connect/github?install=1&return=…`;
  - **Change repositories**, which opens
    `github.com/apps/<slug>/installations/<id>`. The slug comes from the
    installation itself (`app_slug`).
- **The box token:** "Unattended work, and anyone who hasn't connected
  GitHub, act on GitHub as **@login**."
  - **Connect for the box** is `/api/connect/github?for=box`. A team that
    wants a neutral author signs in to GitHub as a bot account first.
  - **Clear** revokes it and deletes it.
  - On a box with no App, an admin pastes a fine-grained token instead
    (§8).
- **Pick repositories,** where `stadeum/code` is installed (§14.4):
  - what the viewer's token reaches, by installation;
  - a checkbox for each, meaning "this box works on it".

  Checking one adds it to the box's list, which `stadeum/code` keeps,
  and creates its webhook with the admin's token (§7). Unchecking
  deletes the webhook and takes the repository off the list. A
  repository newly granted on GitHub appears at once, unchecked:
  granting reach is not choosing to work on it.

  GitHub lets only a repository's admins create webhooks. When the admin
  isn't one, the repository shows "no webhook: checked every 15
  minutes". A repository added by its address in the Code app has no
  webhook either, until an admin turns one on here.

**What it keeps: nothing.**

- **The box's repositories** and their workspaces are `stadeum/code`'s
  (§14.4).
- **Tokens** are strut's secrets. Who is connected is read from GitHub
  with each person's own token.
- **A webhook** is found on its repository by the webhook's address, so
  no id is kept.

**Its workflows:**

- **`on-event`,** run by each webhook delivery (§7):
  - a push to a repository's default branch runs `stadeum/code`'s
    `check` for that repository (open question 16);
  - pull request, review and CI events are recorded on the repository,
    for jobs to read;
  - a delivery for a repository that has left the list deletes its
    webhook.
- **No check of its own.** The check for new commits and `ingest` are
  `stadeum/code`'s (§14.4): they name no forge. A dead token shows when
  it's used: strut's GitHub steps already say "connect GitHub again" on
  a 401 (`src/steps/lib/github/pr-status.ts:110`).
- **`forget`,** on a person's removal: it runs as that person, revokes
  their token and deletes it. **`retire`,** on the box's teardown: it
  deletes the box's webhooks while the tokens still work, then revokes
  the box token after strut has run `forget` for everyone. Both
  are events strut runs, a capability to add (§5).

**Steps:** the app's own: `me`, `disconnect`, `installations`,
`available`, `pick`, `box-token`.

### 3.2 `stadeum/pods`: a workspace is a set of the box's repositories

Today `claim` takes any workspace name (`package/steps/claim.ts:22-26`),
and a bare pod tells the agent to clone by hand. Proposed:

- **`claim { workspace }`** reads the workspace's repositories from the
  graph, main first.
- **On a bare pod,** `claim` clones each one into `/workspaces/<name>`,
  the way `git` runs commands now: through podd's exec, with the token
  only in that command's `GIT_ASKPASS`. The token is the run's for that
  repository's host (§5, item 9): the person's, else the box's. So a
  GitLab or Forgejo repository clones the same way, and so does pods'
  `git` push.
- **On a pod from an image,** it fetches each repository and leaves the
  pull to the agent, as now.
- **A workspace with no nodes** (`stadeum/code` not installed, or an
  unknown name): `claim` behaves as today.

The pods service doesn't change. It never sees a repository or a token.
The `<workspace> pod` Concept pages stop listing repositories, which the
workspace now holds. They keep what jobs learned about running it.

### 3.3 Why not one `software` package

A `software` package whose `strut.yaml` requires github and pods fails in
strut today, for two reasons:

- **Pins.** `requires.packages` names each package at one digest (strut
  `src/packages/format.ts:85-87`). So every pods release would need a
  `software` release too. And a box that has pods at another digest
  refuses the install (`src/packages/install.ts:606-616`).
- **The secrets gate.** A `git+` subscription checks only the followed
  package's own `requires.secrets` (`src/packages/subscriptions.ts:371`).
  A required package comes in ungated. So pods' tools would land on a box
  with no pods service, which the gate was built to stop (strut
  `plans/followed-repos.md` §2).

The fix belongs in strut, as a **bundle** (§5): a package that lists other
packages by the ref it follows, with no pins. A subscription to it gates
each listed package on its own secrets, and each moves on its own branch.
Software is then one bundle, `stadeum/software`, one subscription:

```yaml
# strut.yaml of stakwork/strut-software
package: stadeum/software
version: 0.1.0
bundle:
  - git+https://github.com/stakwork/strut-github@stable
  - git+https://github.com/stakwork/strut-pods@stable
```

Until bundles exist, the button makes a subscription for each package
itself. §14.4 proposes a third package in the bundle, `stadeum/code`.

### 3.4 Separate packages, and where repositories go

- **GitHub without pods** works: the graph knows the code, and jobs check
  out with strut's own `git/checkout` (`src/workflows/job.yaml:20`).
- **Pods without GitHub** works as today.
- **Different secrets.** Pods waits for `PODS_URL` and `PODS_TOKEN`. In
  one package with pods, GitHub would wait for them too.
- **Repositories go with `stadeum/code`** (§14.4), not with GitHub. The
  list, its workspaces, the check for new commits and `ingest` name no
  forge. Listing what a GitHub token can reach is GitHub's, as one way
  to fill the list. Another forge (GitLab, Forgejo) is its own package
  that connects through the same seam and fills the same list. Its token
  reaches git by host (§5, item 9), strut refreshes it (item 8), and its
  webhooks use one of strut's schemes (item 7).

Pods reads the nodes and requires neither package, so §3.3's pin never
applies. The contract is the node's fields, written on `stadeum/code`'s
Concept page.

## 4. What Stadeum still does

All of it is generic. Only the connect seam's provider table names
GitHub:

- **The connect seam** (§2.1): two routes, a third once a provider's
  tokens expire, and the provider table. It
  keeps no state, so `stadeum.db` gains nothing and rule 6 is unchanged.
- **Install from a repository.** The Packages page installs only
  `publisher/name` from an index today
  (`ui/src/app/(app)/packages/actions.ts:75-78`). It gains **From a
  repository**: a `git+https://…[@branch][#folder]` ref, with **Keep it up
  to date** on by default.
  - On, it's a subscription (`PUT /packages/subscriptions/:id { ref }`).
  - Off, it's one install (`POST /packages/install { ref }`).

  A private repo is read with `GITHUB_TOKEN`: the admin's own for an
  install, the box token for a subscription. Like every install, this is
  for admins only.
- **The Software button.** A card on the Packages page, "Your
  repositories, known to the box and in its graph, and a machine of its
  own for every coding job." It makes one subscription to the bundle
  (two, until bundles exist), syncs it, and shows each package's state:
  installed at which commit, waiting for which secrets, or the last
  error. **Remove Software** deletes the subscription and uninstalls what
  it brought. The ref is one constant in `ui/src/lib/packages.ts`. It
  moves to the followed index's featured list once an index can carry
  one.
- **A person leaves.** Removing a member deletes their delegation today
  (`ui/src/app/(app)/members/actions.ts:48-55`). It also calls strut's
  `DELETE /actors/:actor`, a capability to add (§5). Strut then runs
  every package's `forget` and drops the person's secrets. Stadeum names
  no package.
- **Settings:**
  - `CONNECT_<PROVIDER>_*` (§2.1), GitHub's first, read by stadeum-ui
    alone. `stack/stadeum.yml` hands them to stadeum-ui's container
    only. Strut's environment block names each of its variables, so they
    never reach strut's container.
  - `CONNECT_TOKEN`, with the first provider that refreshes. Compose
    hands it to stadeum-ui and strut, and `CONNECT_URL` to strut. Strut
    uses them itself to refresh secrets (§5, item 8). No package sees
    them.
  - A forge's address, `CONNECT_GITLAB_URL` or `CONNECT_FORGEJO_URL`,
    also reaches strut as `GITLAB_URL` or `FORGEJO_URL`, as `PODS_URL`
    does. Its package reads it for its API and for the host it serves
    (§5, item 9).
  - `STRUT_SUBSCRIPTIONS` (§6), passed through to strut.

  They go in `.env.example`. `install.sh` takes the others as a host's
  answers (`STADEUM_CONNECT_GITHUB_*`, never asked on a terminal), and
  `init-env.sh` makes `CONNECT_TOKEN`.
- **ops** syncs every subscription strut lists in the nightly window,
  after strut's image. Strut runs with `STRUT_DISTRO_POLL_MINUTES=0`
  (`plans/pods.md`). The list comes from strut, not from ops's image.

The seam ships on its own, before any strut change. Once it does, each
person's `GITHUB_TOKEN` reaches strut, and pods' `git` can push.

## 5. Strut capabilities to add

Each is generic: no GitHub in it. Each is what lets a package own a
feature end to end.

Items 1, 5, 7, 9, 10 and 14 take one shape: a few lines in `strut.yaml`
name something the package carries and say which of strut's own parts
may use it. `job:` does this today for the job agent's tools (strut
`src/packages/format.ts:13`). So a package stays five folders and a
manifest, and gains no new kind of thing.

| # | Capability | Why | Today |
| --- | --- | --- | --- |
| 1 | **A package's steps manage the secrets it `provides`:** read the person's own value apart from the deployment's; delete the person's own; set and delete the deployment's from an admin's call | Disconnect, Clear the box token, a pasted token (a Telegram bot's, an IMAP password), and "Connected as @login" without mistaking the box token for the person's | Steps only read, through one merged lookup (`src/capabilities.ts:59-67`). Writes take the full scope (`src/createStrut.ts:7549`) |
| 2 | **An admin's call from a package's app:** a package's `admin: true` app, shown to an admin, gets the admin's scope for its own steps | The box token and the org's repositories are an admin's to set | The admin door serves only strut's first-party pages (`specs/API.md` §14.14, `src/steps/lib/earnings/_door.ts:1-15`) |
| 3 | **Schedules a package ships:** a default automation on a workflow, installed with it and dropped with it | `check` runs every 15 minutes with nobody setting it up | Automations are workflow metadata, never in the package's YAML (`docs/automations.md`, "Key concepts") |
| 4 | **Events a package's workflow runs on:** `actor.removed`, run as that actor, with `DELETE /actors/:actor`, which then drops the actor's secrets; `retire`, with `POST /retire`, which runs `actor.removed` for every actor first | Revoking a leaver's token, and every token at teardown, from the package that holds them | The actor secret routes delete one name at a time (`src/createStrut.ts:7569`). There are no events |
| 5 | **Bundles:** `bundle:` in `strut.yaml`, refs followed by branch, each package gated on its own secrets | Software as one subscription, with no pins (§3.3) | `requires.packages` pins a digest, and a `git+` subscription gates only its own package |
| 6 | **First-boot subscriptions:** `STRUT_SUBSCRIPTIONS`, the twin of `STRUT_PACKAGES`, each made once and never remade after an admin deletes it | Fleet boots a box with Software (§6) | `STRUT_PACKAGES` installs once and never moves (`src/packages/boot.ts`) |
| 7 | **Webhook routes for packages:** `hooks:` in `strut.yaml`. Each is served at `POST /hooks/<publisher>/<package>/<name>` on strut's public origin. Before anything runs, strut checks the delivery in constant time, against a secret the package names, by a `scheme` it knows: **`hmac-sha256`**, of the raw body, in a header the package names, with an optional prefix and hex or base64 (GitHub's `X-Hub-Signature-256`, Forgejo's `X-Forgejo-Signature`, Linear's, Shopify's); **`standard-webhooks`**, HMAC-SHA256 over the id, timestamp and body in `webhook-signature`, refusing old timestamps (GitLab's signing token, and others on that spec); **`token`**, a header that holds the secret itself (GitLab's older `X-Gitlab-Token`). It caps the body's size and the rate, answers 202 at once, and runs the package's workflow detached with the event. With no secret set, the route answers 404. Uninstalling the package removes the route | Real-time events from repositories, delivered to the box (§7), from any forge. A package names a scheme and writes no checking code | Strut has no route a package can declare |
| 8 | **Secrets that refresh themselves:** the connect seam's callback writes a secret with its expiry and refresh token. When a step reads it near its expiry, strut calls the seam's refresh route (§2.1) with `CONNECT_URL` and `CONNECT_TOKEN`, stores the new pair, and hands over the new value. It refreshes one secret at a time. When the provider refuses the refresh token, strut drops the secret, so the step finds it missing and says to connect again | Google, Microsoft, GitLab and Forgejo tokens last an hour or two. Every reader gets a live token without code of its own, and two runs never spend one refresh token | A secret is a plain value, with no expiry |
| 9 | **Git credentials by host:** a package declares the hosts its token serves, `provides: git: [{ host, secret }]`. The host can come from a setting, for a company's own forge. Any step asks strut for a repository URL's credentials and gets the run's token for that host: the person's, else the box's, refreshed if need be (item 8). Strut's own git steps and `git+` installs use the same lookup | Pods' `claim` and `git`, `git/checkout` and `git+` installs reach GitHub, GitLab and Forgejo repositories with the right token, and none of them names a forge | Each reads `GITHUB_TOKEN` by name (§2). A subscription can name one `tokenSecret` |
| 10 | **A dream source a package ships:** `dream:` in `strut.yaml`. Each entry names a page the package carries under `Dream` (the rules), a step it carries (the material), the tree they tend and how often (§14.2). Strut makes the automation on `dream` for the entry. The dream calls the step in place of `dream/turns`, with the cursor it kept, and gets `{ count, text, cursor }`. Strut keeps a cursor for each tree and source. A lesson says where in the material it came from, and its claim is optional | The Codebase tree, kept by the dream from merged changes (§14.2). Any package can feed a tree the same way: tickets, mail, a wiki | The dream reads `dream/turns` by name (`src/workflows/system/dream/workflow.yaml:117`). Its marks are a conversation and a turn, one file for each tree (`src/steps/lib/dream/_state.ts`). A lesson requires `session`, `turn`, `said` and `claim` (`workflow.yaml:180`). The page can't name the step itself: a page carries only the fields `Concept` declares (`docs/knowledge.md:593`) |
| 11 | **A tender tests its change:** where a page's claims carry cases, the dream runs a test of the page as it is against the page with its change. The verdicts go with the change: on the proposal where the tree is reviewed, in the history where it isn't | "When an update is proposed, run a bunch of previous tasks against it" (§14.3) | `knowledge/test` answers strut's own page shown to an admin, never a workflow (`docs/knowledge.md:429-437`) |
| 12 | **A package's pages' claims, recorded at install** and dropped with it | A package ships its pages with their checks and cases, so `Repository Changes` is measured from the first day | The install's outcome carries them, and nothing records them (`docs/knowledge.md:400`) |
| 13 | **A trial that runs a job:** a case whose replay starts a job in a pod of its own, released once the sample is judged | A past coding task replayed against a change (§14.3). Later | A trial starts no job (`src/createStrut.ts:8428`) |
| 14 | **Panels:** `panels:` in `strut.yaml` names one of the package's apps as a section for a graph type. A page that shows a node of that type asks for its panels, and each installed package's section is drawn in place, opened on the node, with that app's own grants | One page for a repository, with a section from each package: its source, its pages, its pod, its code graph (§14.4). Any type can have them: a customer, a matter | An app can link to another app (`kit/src/links.ts:17`). It can't show one: its page allows no frames (`src/apps/build.ts:217`) |

Not needed now, and kept for later:

- **A non-secret setting for a package.**

## 6. Fleet

- **The App.** Fleet holds the App's client id, secret and slug in
  `fleet.env`. It gives every box all three as `STADEUM_CONNECT_GITHUB_*`
  answers, beside `STADEUM_SIGNIN_BOUNCE`. Its list of answers
  (`app/src/lib/jobs.ts:698-711`) gains them. The secret is on Stakwork's
  boxes on the same terms as Google's and Microsoft's (fleet `PLAN.md` §6).
- **Software at boot.** A box ordered with Software gets the answer
  `STADEUM_STRUT_SUBSCRIPTIONS` with the bundle's subscription, which
  `install.sh` writes to `.env` as `STRUT_SUBSCRIPTIONS`. Strut makes it
  at first boot (§5, item 6). `STRUT_PACKAGES` won't do: strut installs
  those once and never moves them, so pods would stay at its first
  version.
- **Pods tenants.** Fleet gives every box one already
  (`app/src/lib/jobs.ts:740-745`). Keep that: a tenant costs nothing
  until a pod runs, and nothing installs pods without the subscription.
- **Teardown.** Before destroying a box, fleet calls strut's
  `POST /retire` over SSM. The GitHub package revokes every token (§9).
- **Moving a box out** (fleet `PLAN.md` §9.6): `POST /retire`, and
  `CONNECT_GITHUB_CLIENT_SECRET` leaves `.env`, so Stakwork's secret
  never leaves Stakwork's machines. The box goes on with its own App or
  a pasted token (§8).

## 7. Real-time updates: repository webhooks to each box

**Decided (owner, 2026-11-19).** Each box gets its repositories' events as
they happen, from webhooks the GitHub package creates. Polling stays as
the fallback.

**How it works:**

1. **Creating the webhook.** When an admin checks a repository, the
   package creates a webhook on it with the admin's token:
   `POST /repos/{owner}/{repo}/hooks`. The webhook is set as follows:
   - **URL:** `https://strut.<host>/hooks/stadeum/github/events`;
   - **content type:** JSON;
   - **secret:** the box's `GITHUB_HOOK_SECRET`. The package makes it
     once, at random, when the first webhook is created;
   - **events:** `push`, `pull_request`, `pull_request_review`,
     `pull_request_review_comment`, `issue_comment`, `check_run` and
     `workflow_run`.

   The package keeps no id: it finds its webhook on a repository by that
   URL.
2. **Receiving a delivery.** Strut checks the signature, then runs
   `on-event` (§5, item 7). A push to the default branch runs
   `stadeum/code`'s `check` for that repository, which calls `ingest`
   (§14.4). The other events are recorded for jobs.
3. **Unchecking or retiring.** Unchecking a repository deletes its
   webhook, and so does `retire` (§9). A delivery for a repository that
   has left the list deletes its webhook too.

**What it needs:**

- **The App's Webhooks permission,** read and write (§13).
- **A repository admin.** GitHub lets only a repository's admins create
  its webhooks. Elsewhere, `check` polls every 15 minutes.
- **A public address.** A box behind NAT, or a laptop, gets no deliveries
  and polls instead. Hosted boxes are public at `strut.<host>` already.
- **Room on GitHub.** GitHub allows 20 webhooks per event on one
  repository, so at most 20 boxes can share a repository.

**What it doesn't need:**

- No central part.
- Nothing from stadeum: strut already serves a public origin.
- Nothing different for hosted and self-hosted boxes. A self-hosted box
  on its own App works the same way.

**The App's own webhook stays inactive.** Relaying it would take a
central service. That service would have to know which boxes follow
each installation, check that a box asking for one can really see it (or
one org's events would leak to another), and sign what it forwards for
each box. It would sit in the path of every box's events and do nothing
for self-hosted boxes.

**What's accepted:**

- **A forged event.** `GITHUB_HOOK_SECRET` sits in strut's secrets, where
  an agent's shell can read it. So an agent could forge events to its
  own box, and to nobody else's: each box has its own secret.
- **Dead webhooks.** A box that dies without running `retire` leaves
  webhooks that fail to deliver until an org admin removes them. GitHub
  shows the failures on the repository's webhook page.

## 8. Self-hosted boxes

Stakwork's App sends its callbacks through the bounce, which redirects
only to `<label>.stakwork.ai`. Stakwork's secret stays on Stakwork's
machines. So a self-hosted box has two choices, both through the same
package:

- **Its own App,** registered by an admin with §13's settings, with the
  callback at `https://<host>/api/connect/github/callback`. The admin
  puts its values in `.env`, and the same seam does the rest.
  `plans/github-app.md` §7's manifest flow could automate the
  registration later.
- **A pasted token,** fine-grained, kept as the box token from the
  package's admin app (§5, item 1). Everything works, but every pull
  request is authored by the token's owner, and the token expires when
  GitHub says.

If a self-hosted box asks for Stakwork's App, the device flow (§2.1) is
the way: it needs neither the bounce nor the secret.

## 9. When a box goes

Tokens live in strut's `actor-secrets.json` and `secrets.json`, and in
the backups. They don't expire, so deleting the machine doesn't end them.

- **Destroy.** Fleet calls `POST /retire`. The GitHub package's `retire`
  deletes the box's webhooks first, while the tokens still work. Then
  `forget` and `retire` send the tokens to `POST /credentials/revoke`.
  Best effort; fleet records the answer. The backups fleet keeps then
  hold dead tokens.
- **A person leaves.** Their `forget` revokes their token (§4).
- **When the box can't run `retire`** (a dead disk): the person revokes
  the App on GitHub, or the org uninstalls it. Both work at once, but for
  every box that person or org uses. The backup is encrypted under a
  password the admin keeps (rule 8).

## 10. Hive's model against the alternatives

With expiry off, GitHub sends no `refresh_token` and no `expires_in`.
Turning expiry on later doesn't expire tokens already issued, so changing
course means asking people to connect again.

| Cost of Hive's model | What limits it |
| --- | --- |
| Stakwork's client secret is on every hosted box, in stadeum-ui. With it, someone could trade a code for a token, or get a person's token by luring them to a link | Only Stakwork has root on its boxes, the bounce redirects only under `stakwork.ai`, and the seam exchanges only codes whose state it signed for the signed-in person (`plans/github-app.md` §3). Google's and Microsoft's secrets already sit there on these terms |
| A token never expires, and strut's container holds it, where agents run shell commands (rule 4) | Revoked on disconnect, on removal and at teardown. The person can revoke the App on GitHub, and the org can uninstall it or unpick repositories |
| One App reaches every org that installed it: a token reaches every installation where its person has access | An org that wants a wall uses its own App (§8). The package keeps the box's work to its own repositories, but a token can't be narrowed |
| One installation per GitHub account: two boxes on one org share what GitHub grants | Each box picks its own repositories from that grant (§3.1) |

| Tokens | Verdict |
| --- | --- |
| **User tokens, expiry off** (Hive) | **Take it.** No refresh, no key, and each token reaches what its person can reach. |
| User tokens, expiry on | It shrinks a token copied out of strut to 8 hours. But the refresh token would have to sit in strut beside it for 6 months, refreshed by a loop that needs the secret, which means stadeum. Not worth it. |
| Installation tokens (private key) | **No.** The key mints a token for every org that installed the App, with nobody behind it. |
| A pasted token | The floor for any box (§8). |

## 11. What changes elsewhere

- **`plans/github-app.md`:**
  - **Stands, generalised:** the App (§2), what is central and the
    secret's terms (§3), the state (§4) and the exchange (§4.3), now the
    seam's. Its repo webhooks pointed at the box (§4.6) stand too, now
    the package's, through strut.
  - **Moves to the package:** the GitHub page, linked installations,
    Change repositories, disconnect, revocation and the box token.
  - **Goes:**
    - stadeum's three tables;
    - the six-hourly check, since a dead token shows when it's used;
    - "No org token" (§5), replaced by the box token.
  - **Deferred:** sign-in with GitHub (§6).
- **`plans/pods.md`:** ops no longer subscribes every box at first boot.
  Software does, and ops syncs every subscription.
- **stakwork/pods `PLAN.md` §8:** the same, plus `claim` cloning the
  workspace's repositories (§3.2). Its package is published to
  `stakwork/strut-pods`, no longer to `stakwork/pods-package`.
- **`AGENTS.md`:**
  - rule 4:
    - the connect seam's client secrets live in stadeum-ui alone;
    - strut holds each person's GitHub token and the box token, so an
      agent's shell can read them, accepted with §9's revocation;
  - the roadmap's step 7 points here.

## 12. Steps

Each is its own PR.

0. This plan, and the owner's answers to §13.
1. **The App** (Stakwork, by hand), registered with §13's settings.
2. **Stadeum: the connect seam** (built 2026-11-20), with GitHub's entry and the fake GitHub in
   `npm run fake-stack` (authorize, `access_token`). It needs nothing
   from strut. Then fleet's `STADEUM_CONNECT_GITHUB_*` answers. From here
   each person's `GITHUB_TOKEN` reaches strut. The refresh route,
   `CONNECT_TOKEN` and the forges' `base` wait for the first provider
   that needs them.
3. **Strut:**
   - secrets a package provides, and an admin's call from a package's
     app (§5, items 1-2);
   - schedules a package ships (item 3);
   - events, `DELETE /actors/:actor` and `POST /retire` (item 4);
   - webhook routes for packages, with the three schemes (item 7);
   - git credentials by host (item 9).

   Secrets that refresh themselves (item 8) wait for the first provider
   whose tokens expire.
4. **`stadeum/code`, the list** (§14.4): the `Repository` type, the Code
   app (add by address, workspaces), `check`, an empty `ingest` and the
   `repositories` tool.

   **`stadeum/github`:**
   - the app, installations, the box token and the picker;
   - webhooks and `on-event`;
   - `forget` and `retire`.
5. **Stadeum:**
   - From a repository, and the Software button as a subscription for
     each package;
   - `DELETE /actors/:actor` on a member's removal;
   - ops syncing every subscription;
   - strut's poll off.
6. **Pods:** `claim` clones the workspace (stakwork/pods).
7. **Strut:** bundles and `STRUT_SUBSCRIPTIONS` (§5, items 5-6). Then
   `stadeum/software`, the button as one subscription, and fleet's
   Software answer and `POST /retire` at teardown.
8. **Ingestion** folds into `ingest` (the owner's).
9. **Code** (§14), on the list of step 4:
   - `explore` and the pages under `Job`. They need nothing from strut.
   - Strut: a dream source a package ships (§5, item 10). Then the
     `Codebase` root, `bootstrap`, `changes` and the `Repository Changes`
     page.
   - Strut: a tender tests its change, and a package's pages' claims at
     install (items 11-12).
   - Strut: panels (item 14). Then each package's section in the Code
     app.
   - `stadeum/aws`: logs (§14.5).

   A trial that runs a job (item 13) and the parser wait.

## 13. The GitHub App's settings

**Answered (owner, 2026-11-19): every recommendation below, Workflows
included.** The owner then chose repository webhooks for real-time
updates (§7), which adds the Webhooks permission.

1. **Which App?** *A new "Stadeum" App,* not Hive's. Hive's install
   returns to Hive's callback, and a token belongs to the App that issued
   it. Orgs on Hive install Stadeum once more.
2. ~~**How does a person connect?**~~ Answered (owner, 2026-11-19): the
   web flow, through the connect seam (§2).
3. **Token expiry?** *Off,* as Hive.
4. **Permissions?**
   - Repository:
     - Contents read and write; Pull requests read and write; Workflows
       read and write; Checks read; Commit statuses read; Metadata read.
       That's what strut's `git/*` and `github/*` steps use (`pr-status`
       reads only check runs and commit statuses).
     - Webhooks read and write, for the package's repository webhooks
       (§7).
   - Account: none (Email addresses only when sign-in with GitHub comes).
   - Not Actions, Issues or Administration.

   Workflows is included (owner). Without it, GitHub refuses a push that
   touches `.github/workflows`, and coding jobs touch CI. With it, a job
   could change CI. Adding a permission later makes every org's owner
   approve again.
5. **Callback and setup URLs?**
   - One callback URL, matched exactly, with wildcards off:
     `https://auth.stakwork.ai/api/connect/github/callback`. Sign-in with
     GitHub would add `https://auth.stakwork.ai/api/auth/callback/github`
     second, when it comes.
   - "Request user authorization (OAuth) during installation" on, so an
     install also connects the installer and returns to that callback.
     GitHub then allows no Setup URL.
   - Device Flow off.
6. **The App's webhook?** *Inactive.* Real-time updates come from the
   repository webhooks the package creates, so nothing central relays
   events (§7).
7. **Public or private?** *Public,* so any org can install it.
8. **One App for every box?** *One for every hosted box* under
   `stakwork.ai`. Self-hosted boxes register their own (§8).
9. **Private key?** *None in use.* Keep any key GitHub makes offline,
   never on a box.

Not about the App: **who is the box token by default?** *Nobody until an
admin connects "for the box".* The GitHub app asks for it on first use,
and suggests a bot account.

## 14. Catching up with Hive: the code features

**Proposed (2026-11-20). Only the goal is the owner's.** Hive and
stakgraph's lab hold *"A LOT of code-specific logic"* that Software is to
replace, and *"the goal isnt to copy line for line, its to migrate the
functionality as SIMPLY and ELEGANTLY and GENERICALLY as possible"*.

Hive built each code feature as code of its own. Strut has since grown
general parts that do most of that work: the dream, the Knowledge app,
claims and trials, jobs, and the git steps. So Software's share is pages
and a few thin workflows over those parts. Where a part falls short, the
fix is a generic strut capability (§5, items 10-14), never code in the
package.

This section covers the lab folders the owner named: `concepts`,
`explore`, `logs` and `pods`. Hive's own app was not re-read for it (open
question 13).

### 14.1 What goes where

Sizes are the lab's, tests included (`stakgraph/mcp/src/lab/`).

| In the lab | Size | In Stadeum | New work |
| --- | --- | --- | --- |
| `concepts/`: walks a repository's pull requests and commits, asks a model which feature each belongs to, and writes `Concept` nodes through a Neo4j store of its own | 8,400 lines | **The dream, with merged changes as a second source,** and `Codebase` as its tree (§14.2) | A step that hands over what merged, a page of rules, and a workflow for a repository's first pages |
| `explore/`: a read-only agent that answers a question from the graph and the repositories | 560 lines | **Moves as it is.** Its workflow is YAML over strut's own steps. Its one step of its own lists the repositories, which become the nodes of the box's list (§14.4) | Little |
| `logs/`: an agent that reads CloudWatch and Quickwit | 1,160 lines | **Not Software.** A package for each place logs are kept, `stadeum/aws` first (§14.5) | The AWS calls, signed, over strut's `http` |
| `pods/`: Hive's pool manager as steps. `pod-setup/`: eleven pages on configuring it | 3,150 lines | **Done:** `stadeum/pods`, 580 lines of steps and one page, with `.pod/` in the repository in place of those pages | `claim` cloning the workspace (§3.2) |
| `code/` and `job/`: the `Code Change` and `Explore` pages | Pages | **Pages the package ships under `Job`,** as pods ships `Pod`. The job agent, `git/*` and `github/*` are strut's already | Pages |

### 14.2 The Codebase tree is the dream's

**What the lab does** (`concepts/workflows/`):

- `bootstrap-then-process`: for a new repository, an agent explores a
  clone and names its features.
- `process-repo-chronological`: reads the pull requests and commits
  merged since a checkpoint from GitHub's API
  (`concepts/steps/fetch-changes.ts`). For each one, `process-change`
  asks a model to decide: add it to a feature, make a new one, rewrite a
  description, or ignore it. A step applies the decision.
- `concepts/pages` then writes each repository's page and the `Codebase`
  root above them (strut `plans/concept-tree.md`).
- It keeps a store of its own (`concepts/store/graphStorage.ts`, 1,885
  lines), `PullRequest` and `Commit` nodes, theme tags, and its prompts
  in the workflows' params.

**What the dream is** (strut `docs/knowledge.md:152`): a workflow that
reads the material that is new since its mark and keeps one tree of
Concepts in step with it. It edits a page as little as would have got it
right. Each tree is automatic or reviewed. The history keeps every
change with the run that made it. Its rules are pages under `Dream`, one
for each kind of source: *"A second kind of source is its page under
`Dream` and the step that hands over its material."*

So the Codebase tree needs no pipeline of its own:

- **The tree.** `Codebase` is the root, shipped by the package: a short
  page that stays as it is, as the dream leaves every root. Under it is a
  page for each repository, and under that a page for each feature.
- **The rules.** A page under `Dream`, `Repository Changes`, shipped by
  the package. It holds what the lab's prompts hold: what a feature is,
  and when a change adds one, rewrites one or is ignored. As a page, it
  is measured and tested like any other (§14.3).
- **The material.** One step, `changes`. For each of the box's
  repositories (§14.4), it hands over the commits on the
  default branch since the cursor: each one's message, its files and a
  capped diff. It reads them from git alone, with `git/checkout` and
  `git log --first-parent`, so it names no forge. A merged pull request
  is such a commit.
- **The first pages.** A workflow, `bootstrap`: `explore`'s skeleton with
  another answer. It checks the repository out, a read-only agent names
  its features, and the repository's page and theirs are written as
  ordinary pages. `ingest` starts it when a repository is added
  (§14.4).
- **The manifest ties them.** A dream source is no new kind of thing in
  a package. It is a page and a step the package carries, named in a few
  lines of `strut.yaml` (§5, item 10), as `job:` names the job agent's
  tools today:

  ```yaml
  # strut.yaml of stadeum/code
  dream:
    - source: Repository Changes   # a page in concepts/, under Dream: the rules
      step: changes                # a step in steps/: what is new since the cursor
      root: Codebase               # the tree it tends
      every: day
  ```

  Strut's own dream runs once a day for the entry. It calls the step,
  reads the page as its rules, and keeps the cursor.

**What strut's dream lacks** (§5, item 10). It is shaped for
conversations in three places:

- it reads `dream/turns` by name
  (`src/workflows/system/dream/workflow.yaml:117`);
- its marks are a conversation and a turn, one file for each tree
  (`src/steps/lib/dream/_state.ts`);
- a lesson requires `session`, `turn`, `said` and `claim`
  (`workflow.yaml:180`).

**What is dropped:**

- **`PullRequest` and `Commit` nodes.** The history has every change to a
  page with the run that made it, and that run's material names the
  commits.
- **Theme tags.**
- **The decision and the step that applies it.** The agent edits the page
  through the Knowledge door.
- **The store.** Pages are ordinary Concepts.
- **A running cost for each repository.** A run carries its own cost.
- **Links from a feature to `File` nodes.** They need the parser (§14.6).
  Until then a feature's page lists its main files by path.
- **A written overview above the repositories.** Opening `Codebase` lists
  each repository with its one line, which the dream keeps.

**What is gained:**

- review as a switch for the tree;
- every change and its diff in the Knowledge app;
- branches, claims and tests (§14.3);
- a second dream on the same tree. With `root: "Codebase"` and the source
  `Assistant Conversations`, what a person corrects ("we use pnpm here")
  lands on the repository's page.

**Who can shape a page.** The material is data, and the dream's agent
has no shell, files or web. Whoever can merge to a default branch can
shape the page that describes it. They can already change its README.

**The other way,** not recommended: the package ships a tender of its
own over the Knowledge steps. It may need nothing from strut (open
question 12). But it would be a second tender to keep in step with the
dream, and what the dream gains later it would not.

### 14.3 Claims on the Codebase tree

The owner (2026-11-20): repository Concepts should be *"integrated with
the Knowledge app stuff: being able to create claims on concepts
generated from repos, so we could give a task and prove that an update
worked. Or when an update is proposed, run a bunch of previous tasks
against it to check"*.

**Built in strut, for any Concept** (`docs/knowledge.md:79`, `:360`):

- **A claim on a page** judges every piece of work that opened the page.
- **A case** is a workflow and its input, kept on a claim. A trial runs a
  claim's cases as fresh runs.
- **A test** runs the same cases on two wordings of a page, the page as
  it is and the page with a change, and counts the verdicts on each. A
  person then takes the change or leaves it.
- **The Knowledge app** draws all of it, for an admin.

A repository's pages are ordinary Concepts, so all of this holds for them
with no code in the package.

| The owner's ask | How |
| --- | --- |
| "give a task and prove that an update worked" | The task is a case on a claim of the page. A test runs it on the page as it was and on the page as it is |
| "when an update is proposed, run a bunch of previous tasks against it" | The dream tests its change before the change lands, and the verdicts go with it (§5, item 11) |

**What is missing:**

- **The dream can't start a test.** The steps that do answer strut's own
  page shown to an admin, never a workflow (`docs/knowledge.md:429-437`).
  Item 11.
- **A case must name a commit.** Otherwise a verdict moves when the code
  does, not when the page does. `git/checkout` takes a `ref` already
  (`src/steps/lib/git/checkout.ts:74`), so the package's `explore` takes
  one for each repository.
- **A package's claims aren't recorded at install.** A page's file can
  carry its claims and cases, but only strut's own are recorded
  (`docs/knowledge.md:400`). Item 12.
- **A case can't be a coding job.** A trial starts no job
  (`src/createStrut.ts:8428`). So a case replays what one run does: a
  question to `explore`, or an orchestrator's turn up to the brief it
  would have sent. Replaying a coding task in a pod is item 13, later.

**Nothing decides by a score.** That ruling stands
(`docs/knowledge.md:426`). A test's verdicts go with the change: on the
proposal where the tree is reviewed, in the history where it isn't. What
a worse result does to an automatic tree is open question 10.

**An update to the code,** not to a page, is covered already:

- **Job claims** (strut `plans/job-claims.md`, built). The job agent
  writes claims about the work and verifies them before it says done. A
  check reads the live app in the job's pod.
- **A feature's page.** Its claims judge every job that opened it. With a
  check that walks the app in the job's pod (a journey, in the notes
  below), each change to a feature is tried against what earlier tasks
  proved. Not planned here.

### 14.4 `stadeum/code`: the repository list and one app

Nothing in §14.2 or §14.3 names GitHub. So the code knowledge is a
package of its own, and it keeps the list of repositories it works from.
A GitLab or Forgejo package would use both whole. Its repository is
`stakwork/strut-code`, public, with a `stable` branch as the others.

**Why the list is here, not in the GitHub package.** A repository is set
up for several things: where it comes from, its pages, its pod, and
later its code graph. The owner (2026-11-20): the code graph comes back
later, and *"each 'repo' needs to be configurable in that way"*. With the
list in the GitHub package, a repository would be set up in three apps,
and in a fourth for the code graph. So one package keeps the list, and
one app shows it.

**What it keeps:**

- **The box's repositories,** as graph nodes: `url`, `name`, default
  `branch`, `workspace`, `main` (the workspace's main repository) and
  `checked` (the head last seen). The graph is in the backup. A
  repository's own settings, the code graph's later, are fields on its
  node. When the parser comes back, its own `Repository` type wins and
  these fields go on it.
- **A workspace is a name on repositories.** By default each repository
  is its own workspace, named after it. An admin can group several:
  `hive` holds `hive` (main), `stakgraph` and `mcp`.

**Its app, Code,** is every person's. It lists the repositories by
workspace:

```text
Code ▸ hive
  hive        main   checked 2 min ago   14 features
  stakgraph   main   checked 9 min ago    9 features
  + Add a repository   [its address]   [pick from GitHub]
```

For an admin it also has:

- **Add a repository** by its address. That works for any forge, since
  git finds its token by host (§5, item 9). Where the GitHub package is
  installed, **Pick from GitHub** opens its picker (§3.1).
- **Workspaces:** group repositories, and name each group's main one.
- **A repository's settings,** with a section for each package:

```text
hive ▸ settings
  Knowledge    14 feature pages, updated today    code
  Code graph   on or off, and its options         code, later
  Source       open in GitHub                     github
  Pod          the pod's own section              pods, with panels
```

**How another package's section gets there:**

1. **Links first.** A strut app can open another app on a thing:
   `appLink` (strut `kit/src/links.ts:17`). Code links to the GitHub
   package's app, opened on the repository. It needs nothing new. Pods
   ships no app today, so it has no line yet.
2. **Panels later** (§5, item 14). A package names one of its apps as a
   section for a graph type, and the section is drawn in place on that
   type's page. Then Code names no other package, and a new package's
   section appears when it is installed. An app's page allows no frames
   today (strut `src/apps/build.ts:217`), so who draws the section is
   open question 17.

**Its workflows:**

- **`check`,** a schedule the package ships (§5, item 3). Every 15
  minutes it runs `git ls-remote <url> HEAD` on each repository, with
  the box's token for that host, which uses no REST quota. When a head
  moved, it records the commit and calls `ingest`. A forge package's
  push event runs it at once for one repository (§7), so the schedule
  is the fallback.
- **`ingest`:** today it only records the commit. **This is where the
  parser plugs in** (§14.6). It also runs once when a repository is
  added.
- **`explore`** and **`bootstrap`** (§14.1, §14.2).

| It ships | What |
| --- | --- |
| Pages | `Codebase` (a root); `Repository Changes` (under `Dream`); `Code Change` and `Explore` (under `Job`) |
| An app | Code |
| A graph type | `Repository` |
| Workflows | `check` and `ingest`; `explore`, open to peers as in the lab; `bootstrap` |
| Steps | `repositories`, a job tool, which also tells `explore` what the box holds; `changes`; the app's own |
| In its manifest | `job:` for `repositories`; `dream:` for the Codebase tree (§14.2); the schedule for `check` |

It requires no secret. Software's bundle becomes github, pods and code
(§3.3). Without a forge package it works on public repositories, added
by their address.

### 14.5 Logs are packages of their own

Logs aren't about code, and where they are kept differs from team to
team.

- **One package for each place logs are kept.** Each ships a `logs`
  workflow with the lab's launch, `{ prompt, session? }`, and answer,
  `{ answer, cost }`, and a page under `Job` that says when to ask it.
- **`stadeum/aws` first,** in `stakwork/strut-aws`: CloudWatch. An admin
  pastes a read-only key, which the package keeps as its secrets (§5,
  item 1).
- **No AWS SDK.** The lab's steps call it from mcp's own code
  (`logs/service.ts:4`). A package's step imports `strut` alone, so the
  calls are signed requests over strut's `http`.
- **The app being developed** logs in its pod: `pod logs`, in
  `stadeum/pods`.

### 14.6 The parsed code graph: later, set up for each repository

Stakgraph parses code into `Function`, `Class` and `Endpoint` nodes.
`explore` uses them where the graph has them and reads the files where it
doesn't (`explore/steps/repositories.ts`). A box has no parser (rule 9),
so Software starts with pages and files.

The owner (2026-11-20): it comes back later, perhaps as a CLI, and each
repository must be configurable for it. So:

- its options are fields on the repository's node, set in the Code app's
  settings for that repository (§14.4);
- the parser runs in `ingest`, which `check` calls when a head moves
  (§12, step 8);
- `explore` uses its nodes with no change.

### 14.7 Not in this section

- **Janitors,** the lab's scheduled clean-ups (`janitor/`).
- **Benchmarks:** `gaia/`, `wfbench/`, `eval/`.
- **The orchestrator and the job agent.** They are strut's own now.
- **`Plan Mode`, `Verify` and `Onboarding`,** pages the lab ships to
  every workspace. They aren't about code (open question 14).

## Open questions

1. **A cap on tokens.** GitHub caps an OAuth App at ten tokens per person
   per scope set, revoking the oldest. Its docs say nothing about a cap
   on a GitHub App's user tokens (checked 2026-11-19). A person on many
   boxes holds one token per box.
2. **Rate limits.** A person's tokens for one App share GitHub's
   5,000-an-hour limit across every box they're on. `ls-remote` keeps the
   check off the REST quota. Is that enough for ingestion?
3. **Where ingestion's nodes live.** These fields go on ingestion's own
   `Repository` type when it folds in. Does that type fit?
4. **Leaving the frame.** The package's app runs framed in stadeum's page.
   Its Connect link must reach the top window, or a new tab, to load
   GitHub. Does strut's frame allow either?
5. **Change repositories.** Does GitHub return to the callback after
   "Change repositories", and with no state? If so, the bounce can't
   route it, and the admin sees GitHub's page and comes back by hand
   (`plans/github-app.md` open question 4).
6. **Jobs and events.** `on-event` records pull request, review and CI
   events on the repository. How a job that waits on CI or a review is
   woken by them is for strut's jobs to decide.
7. **Google's verification.** Gmail's scopes and Drive's full scope are
   restricted. Before people outside Stakwork can grant them, Google must
   verify the app, with a yearly security assessment. Until then, an
   app in testing gets refresh tokens that last 7 days. A Google
   package's first scopes could be ones that need less.
8. **Forgejo's scopes, and GitLab's refresh.** Does the Forgejo version in use honour an
   OAuth app's scopes, or grant everything the person can do? Check it
   before the Forgejo package lists any. GitLab's docs say spending a
   refresh token invalidates the old pair, though a GitLab issue reports
   that old tokens keep working. Item 8 is built for the strict case.
9. **What starts the first pages.** `ingest` starts `bootstrap` when a
   repository is added (§14.2). A repository added before the pages
   shipped has none. Does `check` start it for any repository with no
   page?
10. **A change that tests worse.** Where a tree is automatic, does a
    worse test hold the dream's change for a person (§14.3)? Strut
    decides nothing by a score today.
11. **A past run as a case.** Who turns a run into a case, with each
    repository at the commit that run read: a person in the Knowledge
    app, or the dream?
12. **May a package's workflow hold the Knowledge door?** Not checked. A
    package's own step can't be in a sealed namespace
    (strut `src/packages/install.ts:715`). Whether its workflow may call
    `knowledge/edit-page` decides what §14.2's other way would need.
13. **Hive's own app.** Its tasks and features, its janitors'
    recommendations and its pull request monitoring were not re-read for
    §14. What of them does a software team on Stadeum still lack?
14. **Ways of working that aren't about code.** The lab ships
    `Plan Mode`, `Verify` and `Onboarding` to every workspace. Are they
    strut's own pages, or a package's?
15. **Two dreams on one tree.** §14.2 runs the dream on `Codebase` from
    two sources. Item 10 gives each its own cursor. Can both edit one
    page in the same night without undoing each other?
16. **A package that names another.** GitHub's `on-event` runs
    `stadeum/code`'s `check` by name, and its picker writes nodes of a
    type `stadeum/code` ships (§3.1). Should strut carry an event one
    package raises and another's workflow runs on, so neither names the
    other?
17. **Who draws a panel.** An app's page allows no frames (§5, item 14).
    Does strut's own page draw each section, or may an app frame this
    strut's own apps?

## Later: workspaces that actually work (notes, not planned)

The owner, 2026-11-19: *"lets not do this yet, but it sounds great."*
These are notes for later. The goal is for Jamie to find a setup that
**works** for him and for the people he works with, not one that only
runs. He goes to the part of the app being worked on, remembers how
the UX works, and shows prototypes on the page itself. That includes
huge end-to-end tests of dozens of systems working together.

The idea: keep **what** a workspace is (its systems, how they connect,
how its UX works) apart from **where** it runs (one pod or several).
Where it runs then becomes a placement decision for the pods service.

1. **Journeys.** Playwright scripts in `.pod/journeys/`, each one walking
   to a screen. One file is four things:
   - Jamie's way to a screen;
   - a demo for a person;
   - an end-to-end test;
   - what a bake must pass, through `check.sh`.

   It's Playwright's own format, like the rest of `.pod/`.
2. **Named states.** Seeds that put the app into a situation, such as
   `empty-account` or `three-overdue-invoices`. A prototype or a
   simulation on the page is a state plus a journey, with hot reload on
   top.
3. **Screens in the graph.** Each screen is a node: its route, how to
   reach it, and its journey. It's linked to the code that renders it,
   which ingestion puts in the graph. Given a diff, Jamie finds the
   screens it touches and opens them in the right state. This memory is
   in strut, so it outlives every pod.
4. **A workspace is its own node, many-to-many with repositories.** In
   §14.4, `workspace` is one field on a repository node, so a repository
   is in only one workspace. stakgraph couldn't be in hive's workspace
   and in a 30-system test as well. **This is the one note that touches
   what's planned now.** Changing the nodes after `stadeum/code`
   writes them means migrating them, so decide before step 4 of §12.
5. **Composition.**
   - Each repository's `.pod/` describes that repository alone: the
     services it needs, the apps it runs, its ports.
   - A workspace composes them. Compose's `include:` does this, and
     `pm2.config.js` can require the others.
   - A workspace with no code of its own is a small workspace
     repository: the composition and the journeys that cross systems.
   - Jamie proposes compositions from the graph: which repository calls
     which endpoints, and which settings point where. `pod survey` grows
     to suggest how to wire them.
6. **Worlds: several pods claimed together.**
   - One description, placed by the service. A small workspace is one
     pod, sized from what its bake measured (pods `PLAN.md` §15 item 13).
   - A big one is split across pods along its HTTP edges. Each pod is
     told its peers' addresses as `POD_URL_<peer>_<port>`, which grows
     out of today's `POD_URL_<port>`.
   - On Lambda (pods `PLAN.md` §7.1), pods are 2, 4 or 8 GB, bursting
     to 4×, and live 8 hours at most.
   - They reach each other only through their HTTPS endpoints: HTTP,
     WebSocket and gRPC, but not raw TCP. So a database stays in the pod
     of the system that owns it.
   - The endpoint's limits suit a test's requests, not heavy traffic.
7. **A metal backend.**
   - Firecracker microVMs, plus Cuttlefish for Android, on an EC2
     bare-metal host.
   - It gives a private network between pods (raw TCP, no endpoint
     limits), KVM for Android, and no 8-hour limit.
   - Lambda's Firecracker gives no nested KVM and is arm64, so an
     Android emulator can't really run there.
   - The pods plan's interface already allows it (§6 there). A world can
     span backends: the web stacks on Lambda, the Android app on metal.
8. **Record and replay between systems.** The HTTP edges between pods
   are where to record. A job runs the few systems under test for real
   and replays the rest from a recording of a full run. The nightly bake
   runs the whole world for real. A replay that fails points at the
   contract that changed.

**The order, when it's time:**
1. Journeys, states and screens (1-3), with the workspace node (4). The
   biggest gain for the least, and no infrastructure.
2. Composition (5).
3. Worlds on Lambda (6).
4. The metal backend (7).
5. Record and replay (8).
