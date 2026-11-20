# Software: GitHub, repositories and pods, as packages

> **Status (2026-11-19): a plan, nothing built.** The owner decided that
> software is a choice each box's admin makes: an admin clicks
> **Software** on the Packages page. Later the same day the owner set the
> direction for how: *"as much as possible … built into the package, and
> as little as possible … into stadeum. I want strut packages to be a VERY
> powerful primitive that can pretty much do everything."* Then the owner
> chose the web flow over the device flow, through a generic connect seam
> in stadeum (§2). The owner approved the GitHub App's settings (§13),
> and chose repository webhooks for real-time updates (§7). Rows marked **owner** in "Decided" are the owner's;
> every other row is *proposed*. Read against stadeum `main` @70d10e0, strut `main`
> @e7663dff, hive `master` @554793fa1, stakwork/pods `main` @2cf4498 and
> stadeum-fleet `main` @6d6f3342. It replaces most of
> `plans/github-app.md` (§11) and `plans/pods.md`'s first-boot
> subscription.

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
| 4 | How a person connects | **The web flow, through a connect seam in stadeum:** two routes that any OAuth provider's package can use. The client secret stays in stadeum-ui. The token goes to strut as the person's secret. Everything else is the package's (§2). | **owner** (2026-11-19: web flow over device flow); the seam's shape is proposed |
| 5 | Which repositories the box works on | **The GitHub package.** It picks them from what the App's installations grant, groups them into workspaces, checks them for new commits, and is where ingestion plugs in (§3.1). | proposed |
| 6 | Unattended work: ingestion, subscriptions to private packages, a job with no person | **A box token:** a token an admin connects "for the box", kept as strut's deployment `GITHUB_TOKEN` (§3.1). | proposed |
| 7 | A `software` package that requires the others | **No.** Strut pins a required package by digest, and a `git+` subscription doesn't gate a required package on its own secrets (§3.3). Software is a **bundle**, a strut capability to add (§5). Until then, the button makes two subscriptions. | proposed |
| 8 | Repositories and pods: one package or two? | **Two:** `stadeum/github` and `stadeum/pods`. Pods reads the repositories through the graph, not by requiring the package (§3.4). | proposed |
| 9 | Fleet boots a box with Software | **First-boot subscriptions** (`STRUT_SUBSCRIPTIONS`), a strut capability to add, not `STRUT_PACKAGES`, which never moves (§6). | proposed |
| 10 | Real-time updates | **Repository webhooks, straight to each box's strut.** The GitHub package creates one on each repository the box works on, and strut receives it on a webhook route the package declares, a capability to add (§5). Polling stays as the fallback. The App's own webhook is inactive, so nothing central relays events (§7). | **owner** (2026-11-19) |
| 11 | Self-hosted boxes | **Their own App, through the same seam, or a pasted token.** Stakwork's App needs the bounce, so it's for hosted boxes (§8). | proposed |
| 12 | When a box goes | **The package revokes every token it holds,** on a strut event fleet triggers before the machine is destroyed (§9). | proposed |

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
| Handing tokens to steps | **Strut, as built** | A run reads its person's secret first, then the deployment's, then the environment (strut `src/actor-secrets.ts:12-17`). `git/checkout`, `github/create-pr`, pods' `git` and `git+` installs all read `GITHUB_TOKEN` |
| Installations, repositories, the box token's display, disconnecting, revoking | **The package** | §3.1 |
| Webhooks | **The package, received by strut** | Repository webhooks to the box's own strut (§7). The App's webhook stays inactive |
| Sign in to the box with GitHub | **Stadeum, later** | Identity is stadeum's (rule 1). It would be Auth.js on the same App (`plans/github-app.md` §6), deferred. People sign in with Google, Microsoft or email, and connect GitHub from the package |

### 2.1 The seam

Two routes in stadeum-ui. They name no package, and they work for any
OAuth provider in a small table.

- **`GET /api/connect/:provider`**, with these parameters:
  - `return`: where to send the person afterwards;
  - `install=1`: start from the provider's install page instead of its
    authorize page;
  - `for=box`: an admin only. The token becomes the box's.

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
  2. writes the token to strut: `pushActorSecret(actor, name, token)`,
     or for `for=box`, the deployment's `name` (`putDeploymentSetting`,
     `client.ts:208`);
  3. redirects to `return`.

  It keeps nothing. On GitHub, installing the App also authorizes the
  installer, and GitHub returns the install to this same callback with a
  code. The seam treats it as a connect and ignores `installation_id`:
  the package reads installations itself.

**The provider table,** `ui/src/lib/connect.ts`, is the only part that
names a provider. For each one it holds four things: the authorize URL,
the install URL (if the provider has one), the token URL, and the secret
name. GitHub's are `login/oauth/authorize`,
`apps/<slug>/installations/new`, `login/oauth/access_token` and
`GITHUB_TOKEN`. Its values come from `.env`: `CONNECT_GITHUB_CLIENT_ID`,
`CONNECT_GITHUB_CLIENT_SECRET` and `CONNECT_GITHUB_SLUG`. A provider is
available when its id and secret are set.

**Three rules keep the seam safe:**

- **The token URL is stadeum's, never a package's.** If a package could
  name it, it could make stadeum send the secret anywhere.
- **`return` must be on the box's own origins:** `https://<host>` or
  `https://strut.<host>`. So the seam is no open redirect.
- **`for=box` is an admin's.** The route checks the session's role, as
  every admin page does.

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

A public repository, `stakwork/github-package`, with the package at its
root and a `stable` branch moved by its promote, as pods does. No service.

```yaml
# strut.yaml
package: stadeum/github
version: 0.1.0
job:
  tools: [repositories]
requires:
  # The person's own or the box's: public repositories need neither.
  optional: [GITHUB_TOKEN, GITHUB_HOOK_SECRET]
provides:
  # New (§5): the secrets its steps may delete, and set from an admin's call.
  secrets: [GITHUB_TOKEN, GITHUB_HOOK_SECRET]
hooks:
  # New (§5): POST https://strut.<host>/hooks/stadeum/github/events
  - name: events
    workflow: on-event
    signature: { header: X-Hub-Signature-256, secret: GITHUB_HOOK_SECRET }
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
- **Repositories:**
  - what the viewer's token reaches, by installation;
  - a checkbox for each, meaning "this box works on it";
  - a workspace name for each.

  A repository newly granted on GitHub appears at once, unchecked:
  granting reach is not choosing to work on it.

  Checking a repository creates its webhook with the admin's token
  (§7), and unchecking deletes it. GitHub lets only a repository's admins
  create webhooks. When the admin isn't one, the repository shows "no
  webhook: checked every 15 minutes".

**What it keeps:**

- **The box's repositories,** as graph nodes: `url`, `name`, default
  `branch`, `workspace`, `main` (the workspace's main repository) and
  `checked` (the head last seen). The graph is in the backup, and
  ingestion hangs the code under each node. When ingestion folds in, its
  own `Repository` type wins and these fields go on it.
- **A workspace is a name on repositories.** By default each repository is
  its own workspace, named after it. An admin can group several: `hive`
  holds `hive` (main), `stakgraph` and `mcp`.
- **Nothing else.** Tokens are strut's secrets. Who is connected is read
  from GitHub with each person's own token.

**Its workflows:**

- **`on-event`,** run by each webhook delivery (§7):
  - a push to a repository's default branch calls `ingest`;
  - pull request, review and CI events are recorded on the repository,
    for jobs to read.
- **`check`,** the fallback, a schedule the package ships (§5). It covers
  repositories with no webhook every 15 minutes, and every repository
  hourly, for deliveries that were lost. For each one it runs
  `git ls-remote <url> HEAD` with the box token, which uses no REST
  quota. When the head moved, `check` calls `ingest` and records the
  commit. It also checks the box token with `GET /user`. A person's dead token shows when it's used: strut's GitHub
  steps already say "connect GitHub again" on a 401
  (`src/steps/lib/github/pr-status.ts:110`).
- **`ingest`:** today it only records the commit. **This is where
  ingestion plugs in.** It also runs once when a repository is checked.
- **`forget`,** on a person's removal: it runs as that person, revokes
  their token and deletes it. **`retire`,** on the box's teardown: it
  deletes the box's webhooks while the tokens still work, then revokes
  the box token after strut has run `forget` for everyone. Both
  are events strut runs, a capability to add (§5).

**Steps:**

- `repositories` (the box's repositories, by workspace), a job tool;
- the app's steps: `me`, `disconnect`, `installations`, `available`,
  `pick`, `box-token`.

### 3.2 `stadeum/pods`: a workspace is a set of the box's repositories

Today `claim` takes any workspace name (`package/steps/claim.ts:22-26`),
and a bare pod tells the agent to clone by hand. Proposed:

- **`claim { workspace }`** reads the workspace's repositories from the
  graph, main first.
- **On a bare pod,** `claim` clones each one into `/workspaces/<name>`,
  the way `git` runs commands now: through podd's exec, with the token
  only in that command's `GIT_ASKPASS`. The token is the run's
  `GITHUB_TOKEN`: the person's, else the box's.
- **On a pod from an image,** it fetches each repository and leaves the
  pull to the agent, as now.
- **A workspace with no nodes** (GitHub not installed, or an unknown
  name): `claim` behaves as today.

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
# strut.yaml of stakwork/software-package
package: stadeum/software
version: 0.1.0
bundle:
  - git+https://github.com/stakwork/github-package@stable
  - git+https://github.com/stakwork/pods-package@stable
```

Until bundles exist, the button makes the two subscriptions itself.

### 3.4 Two packages, and why repositories go with GitHub

- **GitHub without pods** works: the graph knows the code, and jobs check
  out with strut's own `git/checkout` (`src/workflows/job.yaml:20`).
- **Pods without GitHub** works as today.
- **Different secrets.** Pods waits for `PODS_URL` and `PODS_TOKEN`. In
  one package with pods, GitHub would wait for them too.
- **Repositories go with GitHub,** not in a third package. Choosing them
  means listing what a GitHub token can reach, so it's GitHub's to do.
  The contract that others read is not GitHub's: a repository node and
  the `ingest` workflow. A second provider (GitLab) would be its own
  package, connecting through the same seam and writing the same nodes.
  Ingestion and the check would then move to a provider-free
  `stadeum/repos`, mechanically.

Pods reads the nodes and doesn't require the GitHub package, so §3.3's pin
never applies. The contract is the node's fields, written on the GitHub
package's Concept page.

## 4. What Stadeum still does

All of it is generic. Only the connect seam's provider table names
GitHub:

- **The connect seam** (§2.1): two routes and the provider table. It
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
  - `CONNECT_GITHUB_*` (§2.1), read by stadeum-ui alone.
    `stack/stadeum.yml` hands them to stadeum-ui's container only. Strut's
    environment block names each of its variables, so they never reach
    strut's container.
  - `STRUT_SUBSCRIPTIONS` (§6), passed through to strut.

  Both go in `.env.example` and come from `install.sh` answers.
- **ops** syncs every subscription strut lists in the nightly window,
  after strut's image. Strut runs with `STRUT_DISTRO_POLL_MINUTES=0`
  (`plans/pods.md`). The list comes from strut, not from ops's image.

The seam ships on its own, before any strut change. Once it does, each
person's `GITHUB_TOKEN` reaches strut, and pods' `git` can push.

## 5. Strut capabilities to add

Each is generic: no GitHub in it. Each is what lets a package own a
feature end to end.

| # | Capability | Why | Today |
| --- | --- | --- | --- |
| 1 | **A package's steps manage the secrets it `provides`:** read the person's own value apart from the deployment's; delete the person's own; set and delete the deployment's from an admin's call | Disconnect, Clear the box token, a pasted token, and "Connected as @login" without mistaking the box token for the person's | Steps only read, through one merged lookup (`src/capabilities.ts:59-67`). Writes take the full scope (`src/createStrut.ts:7549`) |
| 2 | **An admin's call from a package's app:** a package's `admin: true` app, shown to an admin, gets the admin's scope for its own steps | The box token and the org's repositories are an admin's to set | The admin door serves only strut's first-party pages (`specs/API.md` §14.14, `src/steps/lib/earnings/_door.ts:1-15`) |
| 3 | **Schedules a package ships:** a default automation on a workflow, installed with it and dropped with it | `check` runs every 15 minutes with nobody setting it up | Automations are workflow metadata, never in the package's YAML (`docs/automations.md`, "Key concepts") |
| 4 | **Events a package's workflow runs on:** `actor.removed`, run as that actor, with `DELETE /actors/:actor`, which then drops the actor's secrets; `retire`, with `POST /retire`, which runs `actor.removed` for every actor first | Revoking a leaver's token, and every token at teardown, from the package that holds them | The actor secret routes delete one name at a time (`src/createStrut.ts:7569`). There are no events |
| 5 | **Bundles:** `bundle:` in `strut.yaml`, refs followed by branch, each package gated on its own secrets | Software as one subscription, with no pins (§3.3) | `requires.packages` pins a digest, and a `git+` subscription gates only its own package |
| 6 | **First-boot subscriptions:** `STRUT_SUBSCRIPTIONS`, the twin of `STRUT_PACKAGES`, each made once and never remade after an admin deletes it | Fleet boots a box with Software (§6) | `STRUT_PACKAGES` installs once and never moves (`src/packages/boot.ts`) |
| 7 | **Webhook routes for packages:** `hooks:` in `strut.yaml`. Each is served at `POST /hooks/<publisher>/<package>/<name>` on strut's public origin. Strut checks the signature (HMAC-SHA256 of the raw body, against a secret the package names) before anything runs, in constant time. It caps the body's size and the rate, answers 202 at once, and runs the package's workflow detached with the event. With no secret set, the route answers 404. Uninstalling the package removes the route | Real-time events from repositories, delivered to the box (§7). Generic: Linear, Shopify and others sign the same way, and other schemes can be added | Strut has no route a package can declare |

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

   The package keeps the webhook's id on the repository's node.
2. **Receiving a delivery.** Strut checks the signature, then runs
   `on-event` (§5, item 7). A push to the default branch calls `ingest`.
   The other events are recorded for jobs.
3. **Unchecking or retiring.** Unchecking a repository deletes its
   webhook, and so does `retire` (§9).

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
  workspace's repositories (§3.2).
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
2. **Stadeum: the connect seam,** with the fake GitHub in
   `npm run fake-stack` (authorize, `access_token`). It needs nothing
   from strut. Then fleet's `STADEUM_CONNECT_GITHUB_*` answers. From here
   each person's `GITHUB_TOKEN` reaches strut.
3. **Strut:**
   - secrets a package provides, and an admin's call from a package's
     app (§5, items 1-2);
   - schedules a package ships (item 3);
   - events, `DELETE /actors/:actor` and `POST /retire` (item 4);
   - webhook routes for packages (item 7).
4. **`stadeum/github`:**
   - the app, installations, the box token and repositories;
   - webhooks and `on-event`, with `check` as the fallback;
   - an empty `ingest`;
   - `forget` and `retire`.
5. **Stadeum:**
   - From a repository, and the Software button as two subscriptions;
   - `DELETE /actors/:actor` on a member's removal;
   - ops syncing every subscription;
   - strut's poll off.
6. **Pods:** `claim` clones the workspace (stakwork/pods).
7. **Strut:** bundles and `STRUT_SUBSCRIPTIONS` (§5, items 5-6). Then
   `stadeum/software`, the button as one subscription, and fleet's
   Software answer and `POST /retire` at teardown.
8. **Ingestion** folds into `ingest` (the owner's).

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
