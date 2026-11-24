# stadeum

GOAL: SIMPLE, ELEGANT, GENERAL, BUILT TO LAST.

A team's private AI workspace on one box in its own cloud. Strut runs the
workflows, the apps and the assistant on a knowledge graph. Every model call
goes through a gateway with a key and a spending cap per person. This file
says how stadeum is put together and what a change must respect, then how to
work on it. Read the rules before adding anything.

## The architecture

| Part | Owns | Never |
| --- | --- | --- |
| **strut** (`ghcr.io/stakwork/strut`) | The product: workflows, apps, the assistant, jobs, the graph's contents, packages | Holds the org signing key or the Docker socket |
| **neo4j** | The graph strut keeps | Updated by anything but a person |
| **bifrost** + **redis** (`ghcr.io/stakwork/mothership`) | Every model call: provider keys, a virtual key and a cap per person; its own OIDC identity, for Anthropic without a key | Lets a call through without a valid delegation |
| **voice** (`sphinxlightning/sphinx-voice`) | A person's voice call with the assistant: the LiveKit room, the agent in it, each turn run through strut as the person | Has a published port, holds the org key or the Docker socket, or keeps what was said: strut's conversation does |
| **treasury** (`ghcr.io/stakwork/sphinx-daemon`) | The Lightning wallet strut sells through, the "Support" contact workers DM, and "Jamie" in the tribes people link from Peel: an account of its own, its seed, the payments it took, the messages and each `@jamie`, handed to strut with its host key, and the replies strut posts back | Has a published port, answers anyone but strut, or runs beside another box on the same account |
| **stadeum-ui** (`ui/`) | Who people are (sign-in, members, roles), the org signing key's use, each person's delegation, the admin pages, the Calls page | Draws an app, or knows what a workflow or document is |
| **ops** (`ops/`) | The box's upkeep: stadeum's releases (its image carries the stack files), strut's updates, old images, backups, restores | Has an open port, or touches an image it never named |
| **caddy** | TLS and routing; the only published ports | Holds any credential but its certificates |
| **bootstrap** | One shot at first boot: the org signing key | Runs again unasked |

### The rules

1. **Stadeum is the box; strut is the product.** Stadeum owns only what
   strut must not: who people are, the org's signing key and each person's
   delegation, and the box itself (updates, backups, domain, TLS).
   Everything a kind of team uses (legal, accounting, a support desk) is a
   strut app or package, never stadeum code. If a change makes stadeum know
   what a workflow, a job, a run or a document is, it belongs in strut.

2. **Stadeum never draws an app.** An app runs in strut's own host page,
   framed, signed in as the person. Stadeum's own pages are sign-in, the
   person, Calls, the connect seam's confirm page, the members and the
   admin pages. The list of apps comes
   from strut, never from a list in this repo.
   - **The rail** holds every app strut lists, so a new one is in it,
     until an admin unpins it on the Apps page. That is stadeum's alone
     (`Org.unpinnedApps`, `ui/src/lib/app-pins.ts`), never strut's pin,
     which holds a version. An unpinned app is out of everyone's rail and
     sits among the org's admin pages, for an admin alone.
   - **Admin-only apps** (`admin: true`, strut `specs/API.md` §14.14)
     are an admin's alone, framed and signed in as the admin, in an
     admin's rail as any app is. Strut lists them to stadeum's key, so a
     member's rail leaves them out, a member gets a 404 for one, and
     strut refuses a member's session one anyway.
     **Earnings** (`strut/earnings`) is one, at its own `/earnings`:
     stadeum knows no payment. Each shows only when strut lists it.
   - **Calls** is stadeum's because a strut app cannot carry live media:
     its frame allows no connections (`connect-src 'none'`). The page
     knows a call, never a conversation, a run or a job. It gets a room
     from strut (`POST /voice/calls`) and joins it; what is said lands in
     the assistant's conversation through strut. It shows the call's own
     live words, both sides, and the artifacts the assistant hands over as
     links that open through strut (its viewer, or the app, framed and
     signed in as the person); it keeps none of it. The `(app)` layout
     holds the call, so it goes on across stadeum's pages, the framed apps
     among them.

3. **Strut is reached only through its HTTP API**, as strut's
   `specs/API.md` documents it, from one client module in each program
   (`ui/src/lib/strut/`, `ops/src/strut.ts`).
   Never through its volumes, its files or its database. When strut lacks
   what stadeum needs, the fix is a strut change, never a workaround here.

4. **The trust boundaries are fixed.**
   - The org signing key, the per-person keys and the gateway's admin
     credentials live in stadeum-ui's database, encrypted under
     `STADEUM_ENCRYPTION_KEY`, and in the `org` volume `bootstrap` writes.
     Nothing else reads them.
   - The connect seam's client secrets (`CONNECT_<PROVIDER>_CLIENT_SECRET`,
     GitHub's and Google's) are in `.env` and stadeum-ui's container alone,
     never strut's or a browser's: with one, a code becomes a token, and a
     refresh token a new one. Strut asks the seam for a refreshed token
     with `CONNECT_TOKEN`, which the two share, on the box's network alone.
   - The Docker socket is mounted in `ops` alone, which has no open port.
     With it ops is the box: it reads every volume it backs up and `.env`,
     and gets the backup credentials from stadeum-ui with the deployment
     key, on the box's network only.
   - No deployment key or shared token ever reaches a browser. A person's
     browser holds only that person's short-lived credentials.
   - The gateway's identity signing key (Anthropic without a key,
     `docs/models.md`) is in the gateway's volume, read by the gateway
     alone. Its public half is published.
   - The gateway's provider endpoints alone are public, at
     `mothership.$HOST`, for a machine strut grants model calls (a pod),
     with its two issuer documents (public keys).
     It holds a key of its own on the person's budget: capped, expiring
     within a day, deleted at release (`docs/models.md`, "A grant's
     key"). The gateway's admin API, plugin routes and dashboard stay on
     the box's network.
   - A call's key is made in the person's browser for that call, and goes
     only to strut and the voice service. LiveKit carries audio it cannot
     read. The LiveKit key pair is in `.env` and the voice container alone.
     Nothing logs, keeps or puts in a URL a call's key, room or tokens.
   - Strut's container holds neither the org key nor the Docker socket:
     its agents run shell commands there. It does hold the treasury's pay
     token, so an agent could spend the treasury's balance: a risk
     accepted on purpose, since the treasury holds only what paid runs
     brought in (`plans/treasury.md` §2). It holds the message token too,
     so an agent could read workers' DMs to Support and write as Support:
     accepted the same way (strut `plans/support-chat.md`, ruling 3). It
     holds the treasury's callback token, so an agent could make Jamie
     post in a linked tribe: accepted, as Jamie's posts there are an
     agent's words already. With
     a run archive it holds that bucket's key, so an agent could read or
     delete the box's archived run logs: accepted, with the key scoped to
     the box's prefix on a versioned bucket. With pods it holds
     `PODS_TOKEN`, so an agent could launch, use and destroy the box's own
     pods, within its tenant's limit: accepted, as it reaches no other
     box's. It holds each person's GitHub token, which the connect seam
     hands it, so an agent could act on GitHub as any of them: accepted,
     with their revocation (`plans/software.md` §9: the GitHub package's,
     to come; until then the person revokes the App on GitHub). It holds
     each person's Google token and its refresh token, so an agent could
     read a person's mail and send as them: accepted, with the person's
     revocation or their Google admin's (`plans/gmail.md`, ruling 11).
     There is no box token: every token the seam writes is a person's. The
     treasury's admin token and seed stay in the treasury's container.

5. **Any cloud.** One compose file is the deployment: stock images, every
   setting in `.env` with a comment in `.env.example`. Nothing depends on
   one cloud's services. Object storage is reached through restic, which
   speaks S3, R2, Azure, GCS, B2 and SFTP; strut's optional run archive
   speaks S3, which R2, B2 and MinIO speak too. Calls go through LiveKit, a
   setting with a working default (`LIVEKIT_URL`, the central
   `wss://livekit.sphinx.chat`): any LiveKit server works, reached
   outbound only.

6. **Off-the-shelf before custom.** Caddy, restic, Auth.js, Prisma: a
   maintained tool beats code of ours. Stadeum's own code is the glue
   nobody else can write. Its database holds people, invites, roles, the
   org's settings (the upkeep window, the backup destination and the
   spending limits among them), each person's gateway records, the status
   checks, what ops did and who changed a spending limit, nothing more.

7. **Pinned, moved on purpose, reversible.** Every image is pinned to a
   version or a channel (`stable`), never `latest`. A release is
   stadeum-ops's image, stadeum-ui's, and the stack files ops's image
   carries; it moves every pin in them. Neo4j moves only when an admin
   confirms it on the box, after a backup: it cannot open a store a newer
   version wrote. An update can be rolled back to the images and stack
   files it replaced. A box's own changes live in `.env` and
   `stack/local.yml`, which no release writes.

8. **The data is the customer's.** Every volume is in the backup, and so
   are the secrets needed to read it, except the backup's own password,
   which the admin keeps outside the box (and the host, when one gives
   it at install). The one volume left out is
   `strut-models`: models strut downloads, which a restored box fetches
   again. The `treasury` volume is money: its seed is in no other place.
   A run log strut's retention moved to its archive bucket is in that
   bucket, and the key to it in `.env`, so in the backup.
   A backup nobody has restored is not one: restoring is part of
   the feature, and it is tested.

9. **It stands alone.** No runtime dependency on Hive, mcp, repo2graph or
   sphinx-swarm's orchestrator. Copy an idea from them, never a call.

10. **Fewer parts.** The fewest containers, settings and pages that do
    the job. A setting has a default that works. Delete before adding.

### Before adding something, ask

- Could strut do it, for every host, instead of stadeum doing it here?
- Could a stock image or a maintained library do it?
- Does it work on every cloud, and on a laptop?
- Is it in the backup, and can it be rolled back?
- Does it need a new secret? Where does that secret live, and who can read it?

## Where it is going (2026-11-05)

The stack runs strut's own image on the stock Neo4j, behind Caddy. The
order of the work, each step its own PR:

0. This file. (Done.)
1. Strut: a per-person sign-in for its framed UI, the standalone twin of
   mcp's `/mint-token` (stakwork/strut#530). (Done.)
2. Strut's own image in place of repo2graph, and Caddy in place of Traefik.
   Neo4j becomes the stock image strut needs, pinned, with no plugins.
   (Done.)
3. Updates: `ops` follows `strut:stable` (and stadeum's own `stable`) in a
   daily window the admin sets. It turns on strut's drain (`PUT /drain`),
   waits for `idle`, pulls, restarts, checks health, and rolls back on
   failure. (Done.) A stadeum release carries its stack files in ops's
   image, and the ops it brings applies them; a release that changes Neo4j
   waits for an admin's Upgrade Neo4j, after a backup. A box needs no git
   checkout. (Done.)
4. Backups: `ops` runs restic to the destination the admin picks. It covers
   every volume (Neo4j's store, strut's data, `stadeum.db`, the `org`
   volume, the gateway's; not strut's downloaded models) and `.env`, with
   what would tear stopped around the same drain: Neo4j community has no
   online dump. Restores are tested (`scripts/backup-restore-e2e.sh`).
   (Done.)
5. Apps from strut's `GET /apps`, with the assistant (Jamie) the first:
   Jamie is the home. (Done.)
6. A custom domain. Caddy fetches the certificates. A new domain also needs
   its sign-in redirect URLs registered with Google and Microsoft, which
   the admin page says.
7. Software: GitHub access, repositories and pods, as strut packages an
   admin turns on, with stadeum keeping only generic seams
   (`plans/software.md`). The connect seam: a person connects GitHub and
   strut gets their own `GITHUB_TOKEN`. (Done.) The Software button: an
   admin follows one strut bundle, `stadeum/software`
   (stakwork/strut-software), and the Packages page shows it with its
   parts. Stadeum knows its ref and one sentence, never what it holds.
   (Done.) Sign-in with GitHub is deferred.
8. Calls: a Calls page in stadeum-ui, where a person talks to the
   assistant by voice. The browser makes a fresh key per call;
   stadeum-ui hands it to strut's `POST /voice/calls` as the person; the
   voice service beside strut (sphinx-voice's 1:1 mode) answers with a
   room on LiveKit its agent joined with that key. LiveKit stays central
   and end-to-end encrypted, as Peel's Talk does. The page shows the live
   transcript and the artifacts handed over, opened through strut. (Done.)
   Every box shares the central LiveKit's key pair (decided 2026-11-14):
   the calls are end-to-end encrypted, so a pair that leaks lets its holder
   join or end a call, never hear one. Later: an option for a box to run
   its own LiveKit.
9. A treasury: the Sphinx daemon beside strut, on an account of its own,
   the Lightning wallet strut sells paid public runs through and an admin
   withdraws from. Its volume is the money, so it is in the backup.
   `plans/treasury.md`. (Done.) Earnings among the org's admin pages, strut's
   `strut/earnings` framed there for an admin (`/earnings`). (Done.)

## Layout

| Path | What |
| --- | --- |
| `stack/stadeum.yml` | The deployment (docker compose), on published images (the voice service's on Docker Hub): a release's, which ops writes onto a box. `stack/local.yml` is a box's own override, never in a release. `stack/dev.yml` overlays local mode: plain http on `*.localhost`, stadeum-ui and ops built here |
| `stack/caddy/Caddyfile` | The routes: `$HOST` → stadeum-ui, `strut.$HOST` → strut, `mothership.$HOST` → the gateway's provider endpoints and its issuer documents alone |
| `stack/bootstrap/` | First boot: the org signing key and its registration with the gateway |
| `ui/` | stadeum-ui: Next.js 15, Auth.js v5, Prisma on SQLite (`/data/stadeum.db`) |
| `ui/src/lib/mothership/` | Each person's virtual key and delegation, minted, pushed to strut, renewed; a grant's key for a machine outside strut (`grant-key.ts`, `ui/src/app/api/mothership/keys/`) |
| `ui/src/lib/strut/` | The strut client: delegations, the status check, the apps, the brand, the frame's sign-in ticket, a call's room |
| `ui/src/app/(app)/apps/` | A strut app framed for the person (`strut-frame.tsx`) and its one-use ticket (`open.ts`); the assistant's frame is the `(app)` layout's (`home-frame.tsx`), kept open across stadeum's pages. `ui/src/app/(app)/earnings/` frames strut's Earnings the same way, for an admin |
| `ui/src/components/call.tsx`, `ui/src/lib/call*.ts` | A call: held by the `(app)` layout, its key and its checks, its LiveKit room (loaded only on a call), its transcript and artifacts; `ui/src/app/api/calls/` hands it to strut, `ui/src/app/(app)/calls/` draws it |
| `ui/src/lib/connect.ts`, `ui/src/app/api/connect/`, `ui/src/app/connect/` | The connect seam: the provider table (GitHub's and Google's entries), the signed state, the confirm page whose Continue sends a person to the provider, the callback that trades the code it sends back for tokens written to strut (with the refresh token, for Google's), and the refresh route strut alone calls for a new access token |
| `ui/src/lib/ops/` | ops's settings, status and history, and the routes it calls (`/api/ops/*`); the Updates and Backups pages |
| `ui/src/lib/models/` | The Models page's work: each provider's key in the gateway, the org's model list and default, carried to every person's virtual key and to strut |
| `ui/src/app/(app)/packages/`, `ui/src/lib/packages.ts` | The Packages page: strut's packages installed, searched, installed and uninstalled, their missing secrets set, the Software card (one bundle followed by its ref, `SOFTWARE_REF`), a package from a repository (followed, as the admin's subscription, or installed once) and what the box follows (a bundle as one row with its parts; checked now, stopped), the indexes followed, and the store's Install link (`?install=`) read |
| `ops/` | stadeum-ops: the update and backup loop, driving `docker compose` and restic, and the release (`src/release.ts`): its image carries `stack/`, built from the repository's root. No runtime dependencies |
| `.github/workflows/` | Checks, and stadeum's images: published from main, promoted to `stable` |
| `scripts/` | `install.sh` (a box on a fresh VM, in one command: Docker, the release's stack files from stadeum-ops's image, `.env`, the DNS check, the stack; or a restore), `install-test.sh` (the install's answers on a re-run, kept or replaced), `init-env.sh` (generates `.env`'s secrets), `promote.sh` (moves strut's or stadeum's `stable` to main's newest images, the Sphinx daemon's to stakwork/sphinx master's newest, or sphinx-voice's or the gateway's to its newest release), the gateway end-to-end check, the backup-and-restore proof, the release proof |
| `docs/` | `stack-spec.md` (the stack, service by service), `mothership-spec.md` (the gateway contract), `models.md` (who picks a model, where the keys live) |
| `plans/` | Work not built yet, one file each, with what is decided and what is open: `software.md` (roadmap step 7: GitHub, repositories and pods as packages, through the connect seam), `github-app.md` (the App, the state and the exchange `software.md` generalises), `treasury.md` (step 9: built, kept for its decisions and what is open), `pods.md` (what Stadeum does for pods, a machine for every coding job; the plan itself is `stakwork/pods`'s `PLAN.md`, proposed), `group-calls.md` (Jamie from a box in a group call, end-to-end encrypted, heard and spoken by strut's own models: the box's `voice` service joins it, proposed), `experiments.md` (experiments in strut's Knowledge app: a person gives a goal and a budget, and Jamie makes up the cases and tests changes to the pages until it stops improving or the budget is spent; how a workspace is set up in a pod is its first use, proposed), `anthropic-federation.md` (Anthropic without a key: the box's gateway is its own OIDC issuer and Bifrost trades its JWT for an hour's token; built for a box, `docs/models.md`; fleet making each box's issuer and rule in place of its key pool is still proposed), `jamie-in-slack.md` (Jamie in a company's Slack workspace: stadeum-ui is the box's Slack host, and the connect seam links each person's Slack account in strut and installs the box's own Slack app, proposed) |

## Running

```bash
scripts/init-env.sh            # .env with generated secrets; provider keys go in on the Models page
```

```bash
docker compose --env-file .env -f stack/stadeum.yml -f stack/dev.yml up -d --wait
```

stadeum-ui alone, against fakes of the stack:

```bash
cd ui && cp .env.example .env && npm install && npx prisma migrate deploy
```

Then set `AUTH_SECRET`, `STADEUM_ENCRYPTION_KEY`, `STADEUM_DEV_LOGIN=1` and
the service URLs (`127.0.0.1:4555/{bifrost,strut,neo4j}`) in `ui/.env`.

```bash
cd ui && npm run fake-stack    # fakes of bifrost, strut and neo4j on :4555
```

A call against the fake joins a real LiveKit room, with no agent in it:
run `livekit-server --dev` beside it (`scripts/fake-stack.ts` says more).

```bash
cd ui && npm run dev
```

Checks: `cd ui && npm run typecheck && npm run lint && npm test`,
`cd ops && npm run typecheck && npm test`, `scripts/install-test.sh` for
the install's answers on a re-run, `scripts/mothership-e2e.sh` for
the gateway path end to end, `scripts/backup-restore-e2e.sh` for a backup
restored onto wiped volumes, and `scripts/release-e2e.sh` for releases
applied to a running box, rolled back, and held for Neo4j.

## Conventions

- A setting is an env variable, listed in `.env.example` with what it does
  and its default. `init-env.sh` generates every secret and never
  overwrites one already set.
- A schema change is a Prisma migration, never an edit to an applied one.
- Docs say what is. A decision and its reason go beside the code it
  shapes, or in `docs/`.
- PRs go against `main`.
