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
| **stadeum-ui** (`ui/`) | Who people are (sign-in, members, roles), the org signing key's use, each person's delegation, the admin pages | Draws an app, or knows what a workflow or document is |
| **ops** | The box's upkeep: image updates, backups | Has an open port |
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
   person, the members and the admin pages. The list of apps comes from
   strut, never from a list in this repo.

3. **Strut is reached only through its HTTP API**, as strut's
   `specs/API.md` documents it, from one client module (`ui/src/lib/strut/`).
   Never through its volumes, its files or its database. When strut lacks
   what stadeum needs, the fix is a strut change, never a workaround here.

4. **The trust boundaries are fixed.**
   - The org signing key, the per-person keys and the gateway's admin
     credentials live in stadeum-ui's database, encrypted under
     `STADEUM_ENCRYPTION_KEY`, and in the `org` volume `bootstrap` writes.
     Nothing else reads them.
   - The Docker socket is mounted in `ops` alone, which has no open port.
   - No deployment key or shared token ever reaches a browser. A person's
     browser holds only that person's short-lived credentials.
   - Strut's container holds neither the org key nor the Docker socket:
     its agents run shell commands there.

5. **Any cloud.** One compose file is the deployment: stock images, every
   setting in `.env` with a comment in `.env.example`. Nothing depends on
   one cloud's services. Object storage is reached through restic, which
   speaks S3, R2, Azure, GCS, B2 and SFTP.

6. **Off-the-shelf before custom.** Caddy, restic, Auth.js, Prisma: a
   maintained tool beats code of ours. Stadeum's own code is the glue
   nobody else can write. Its database holds people, invites, roles, the
   org's settings, each person's gateway records and the status checks,
   nothing more.

7. **Pinned, moved on purpose, reversible.** Every image is pinned to a
   version or a channel (`stable`), never `latest`. An update can be rolled
   back to the image it replaced. Neo4j moves only when a person moves it,
   after a backup: it cannot open a store a newer version wrote.

8. **The data is the customer's.** Every volume is in the backup, and so
   are the secrets needed to read it, except the backup's own password,
   which the admin keeps outside the box. A backup nobody has restored is
   not one: restoring is part of the feature, and it is tested.

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
   mcp's `/mint-token` (a strut PR).
2. Strut's own image in place of repo2graph, and Caddy in place of Traefik.
   Neo4j becomes the stock image strut needs, pinned, with no plugins.
   (Done.)
3. Updates: `ops` follows `strut:stable` on a schedule the admin sets. It
   turns on strut's drain (`PUT /drain`), waits for `idle`, pulls,
   restarts, checks health, and rolls back on failure.
4. Backups: `ops` runs restic to the destination the admin picks. It covers
   the Neo4j dump, strut's data, `stadeum.db`, the `org` volume and the
   secrets, around the same drain. Restores are tested.
5. Apps from strut's `GET /apps`, with the assistant (Jamie) the first.
6. A custom domain. Caddy fetches the certificates. A new domain also needs
   its sign-in redirect URLs registered with Google and Microsoft, which
   the admin page says.
7. GitHub sign-in, with each person's GitHub token handed to strut as their
   own `GITHUB_TOKEN` (low priority).
8. Calls: sphinx-voice beside strut (low priority).

## Layout

| Path | What |
| --- | --- |
| `stack/stadeum.yml` | The deployment (docker compose). `stack/dev.yml` overlays local mode: plain http on `*.localhost` |
| `stack/caddy/Caddyfile` | The routes: `$HOST` → stadeum-ui, `strut.$HOST` → strut |
| `stack/bootstrap/` | First boot: the org signing key and its registration with the gateway |
| `ui/` | stadeum-ui: Next.js 15, Auth.js v5, Prisma on SQLite (`/data/stadeum.db`) |
| `ui/src/lib/mothership/` | Each person's virtual key and delegation, minted, pushed to strut, renewed |
| `ui/src/lib/strut/` | The strut client: delegations, the status check, the frame's sign-in ticket |
| `scripts/` | `init-env.sh` (generates `.env`'s secrets), the gateway end-to-end check |
| `docs/` | `stack-spec.md` (the stack, service by service), `mothership-spec.md` (the gateway contract) |

## Running

```bash
scripts/init-env.sh            # .env with generated secrets; then fill in provider keys
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

```bash
cd ui && npm run dev
```

Checks: `cd ui && npm run typecheck && npm run lint && npm test`, and
`scripts/mothership-e2e.sh` for the gateway path end to end.

## Conventions

- A setting is an env variable, listed in `.env.example` with what it does
  and its default. `init-env.sh` generates every secret and never
  overwrites one already set.
- A schema change is a Prisma migration, never an edit to an applied one.
- Docs say what is. A decision and its reason go beside the code it
  shapes, or in `docs/`.
- PRs go against `main`.
