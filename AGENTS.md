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
| **bifrost** + **redis** (`ghcr.io/stakwork/stakgraph-gateway`) | Every model call: provider keys, a virtual key and a cap per person | Lets a call through without a valid delegation |
| **voice** (`sphinxlightning/sphinx-voice`) | A person's voice call with the assistant: the LiveKit room, the agent in it, each turn run through strut as the person | Has a published port, holds the org key or the Docker socket, or keeps what was said: strut's conversation does |
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
   person, Calls, the members and the admin pages. The list of apps comes
   from strut, never from a list in this repo.
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
   - The Docker socket is mounted in `ops` alone, which has no open port.
     With it ops is the box: it reads every volume it backs up and `.env`,
     and gets the backup credentials from stadeum-ui with the deployment
     key, on the box's network only.
   - No deployment key or shared token ever reaches a browser. A person's
     browser holds only that person's short-lived credentials.
   - A call's key is made in the person's browser for that call, and goes
     only to strut and the voice service. LiveKit carries audio it cannot
     read. The LiveKit key pair is in `.env` and the voice container alone.
     Nothing logs, keeps or puts in a URL a call's key, room or tokens.
   - Strut's container holds neither the org key nor the Docker socket:
     its agents run shell commands there.

5. **Any cloud.** One compose file is the deployment: stock images, every
   setting in `.env` with a comment in `.env.example`. Nothing depends on
   one cloud's services. Object storage is reached through restic, which
   speaks S3, R2, Azure, GCS, B2 and SFTP. Calls go through LiveKit, a
   setting with a working default (`LIVEKIT_URL`, the central
   `wss://livekit.sphinx.chat`): any LiveKit server works, reached
   outbound only.

6. **Off-the-shelf before custom.** Caddy, restic, Auth.js, Prisma: a
   maintained tool beats code of ours. Stadeum's own code is the glue
   nobody else can write. Its database holds people, invites, roles, the
   org's settings (the upkeep window and the backup destination among
   them), each person's gateway records, the status checks and what ops
   did, nothing more.

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
   which the admin keeps outside the box. The one volume left out is
   `strut-models`: models strut downloads, which a restored box fetches
   again. A backup nobody has restored is not one: restoring is part of
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
7. GitHub sign-in, with each person's GitHub token handed to strut as their
   own `GITHUB_TOKEN` (low priority).
8. Calls: a Calls page in stadeum-ui, where a person talks to the
   assistant by voice. The browser makes a fresh key per call;
   stadeum-ui hands it to strut's `POST /voice/calls` as the person; the
   voice service beside strut (sphinx-voice's 1:1 mode) answers with a
   room on LiveKit its agent joined with that key. LiveKit stays central
   and end-to-end encrypted, as Peel's Talk does. The page shows the live
   transcript and the artifacts handed over, opened through strut. (Done.)
   Next: one LiveKit key per box once a box's provisioning can mint one
   (the LiveKit server has no API for it yet).

## Layout

| Path | What |
| --- | --- |
| `stack/stadeum.yml` | The deployment (docker compose), on published images (the voice service's on Docker Hub): a release's, which ops writes onto a box. `stack/local.yml` is a box's own override, never in a release. `stack/dev.yml` overlays local mode: plain http on `*.localhost`, stadeum-ui and ops built here |
| `stack/caddy/Caddyfile` | The routes: `$HOST` → stadeum-ui, `strut.$HOST` → strut |
| `stack/bootstrap/` | First boot: the org signing key and its registration with the gateway |
| `ui/` | stadeum-ui: Next.js 15, Auth.js v5, Prisma on SQLite (`/data/stadeum.db`) |
| `ui/src/lib/mothership/` | Each person's virtual key and delegation, minted, pushed to strut, renewed |
| `ui/src/lib/strut/` | The strut client: delegations, the status check, the apps, the brand, the frame's sign-in ticket, a call's room |
| `ui/src/components/call.tsx`, `ui/src/lib/call*.ts` | A call: held by the `(app)` layout, its key and its checks, its LiveKit room (loaded only on a call), its transcript and artifacts; `ui/src/app/api/calls/` hands it to strut, `ui/src/app/(app)/calls/` draws it |
| `ui/src/lib/ops/` | ops's settings, status and history, and the routes it calls (`/api/ops/*`); the Updates and Backups pages |
| `ui/src/lib/models/` | The Models page's work: each provider's key in the gateway, the org's model list and default, carried to every person's virtual key and to strut |
| `ops/` | stadeum-ops: the update and backup loop, driving `docker compose` and restic, and the release (`src/release.ts`): its image carries `stack/`, built from the repository's root. No runtime dependencies |
| `.github/workflows/` | Checks, and stadeum's images: published from main, promoted to `stable` |
| `scripts/` | `install.sh` (a box on a fresh VM, in one command: Docker, the release's stack files from stadeum-ops's image, `.env`, the DNS check, the stack; or a restore), `init-env.sh` (generates `.env`'s secrets), `promote.sh` (moves strut's or stadeum's `stable` to main's newest images), the gateway end-to-end check, the backup-and-restore proof, the release proof |
| `docs/` | `stack-spec.md` (the stack, service by service), `mothership-spec.md` (the gateway contract), `models.md` (who picks a model, where the keys live) |

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
`cd ops && npm run typecheck && npm test`, `scripts/mothership-e2e.sh` for
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
