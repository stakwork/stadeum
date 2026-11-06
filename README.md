<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <img src="docs/logo-light.svg" width="72" height="72" alt="stadeum logo">
</picture>

# stadeum

A private AI workspace your team runs in its own cloud. It turns your
documents into a knowledge graph, runs Strut workflows and apps on it, and
routes every model call through a gateway with a key and a spending cap per
person. Your data, keys and models stay in your account.

## Install on a server

On a fresh Ubuntu 22.04, 24.04 or 26.04, or Debian 12 or 13 VM, on any cloud:

```bash
curl -fsSL https://raw.githubusercontent.com/stakwork/stadeum/main/scripts/install.sh | sudo bash
```

Or run `sudo scripts/install.sh` from a clone. The script installs Docker
from Docker's apt repository if it is missing, writes the stack files of
stadeum's stable release into `/opt/stadeum/stack` (stadeum-ops's image
carries them: the box needs no git checkout) and makes `.env`. It asks for
the domain, an email for Let's Encrypt and a Google or Microsoft sign-in,
checks DNS, starts the stack and checks its certificates. Model keys go in
afterwards, on Organisation → Models (the gateway keeps them, never
`.env`). Run it again to restart with the same `.env`: it asks only for
what `.env` lacks, and writes back the stack files of the release the box
runs. From then on ops keeps the box current, files and all.

- **The box's own changes** go in `/opt/stadeum/stack/local.yml`, a compose
  override read last when it is there (a port, a memory size, an image
  pinned on this box), and in `.env`. A release never writes either, and
  overwrites the rest of `stack/`.

- **DNS**, before it starts: two A records at the VM's public IPv4 address.
  The script checks them and starts nothing until both point at the VM.

  | Name | Type | Value |
  | --- | --- | --- |
  | `stadeum1.example.com` (`HOST`) | A | the VM's public IPv4 |
  | `strut.stadeum1.example.com` | A | the same |

- **Sign-in redirect URLs**, registered in each provider's OAuth client:
  Google `https://$HOST/api/auth/callback/google`, Microsoft
  `https://$HOST/api/auth/callback/microsoft-entra-id`.
- **Ports** 80 and 443 (TCP, and 443 UDP) open to the internet in the
  cloud's firewall or security group. Caddy fetches and renews the
  certificates through them, and they are the only ports the stack
  publishes.
- **Sign in first**: the first person to sign in becomes admin.
- A scripted install answers each question with `STADEUM_` and the `.env`
  name, placed after `sudo` (which drops the environment). The full list is
  at the top of `scripts/install.sh`:

```bash
curl -fsSL https://raw.githubusercontent.com/stakwork/stadeum/main/scripts/install.sh | sudo STADEUM_HOST=stadeum1.example.com STADEUM_ACME_EMAIL=admin@example.com STADEUM_AUTH_GOOGLE_ID=… STADEUM_AUTH_GOOGLE_SECRET=… bash
```

- It refuses `STADEUM_DEV_LOGIN`: on a public host the password-less login
  lets anyone sign in as anyone.

## Layout

| Path | What |
| --- | --- |
| `stack/` | `stadeum.yml` (docker compose): caddy, neo4j, strut + strut-browser, voice (calls), bifrost + redis (LLM gateway), maple, stadeum-ui, ops. `caddy/Caddyfile`: the routes. On a box these are a release's, and `local.yml` is the box's own |
| `stack/bootstrap/` | First-boot setup: the org signing key and its registration with bifrost |
| `ui/` | stadeum-ui: single sign-on, members, status, updates, backups, per-person model access, app launcher, calls |
| `ops/` | stadeum-ops: releases, updates and backups (the Docker socket's one holder, no port). Its image carries the release's stack files |
| `.github/workflows/` | Checks; stadeum's images, published from main and promoted to `stable` |
| `scripts/` | The server install, env setup, promoting a release (`promote.sh strut`, `promote.sh stadeum` or `promote.sh voice`), the end-to-end gateway check, the backup-and-restore proof, the release proof |
| `docs/` | Stack and gateway specs |

## Run the stack

```bash
scripts/init-env.sh            # .env with generated secrets
```

```bash
docker compose --env-file .env -f stack/stadeum.yml -f stack/dev.yml up -d --wait
```

- Every image is published: strut and strut-browser on strut's `stable` channel, stadeum-ui and ops on stadeum's (`ghcr.io/stakwork/stadeum-ui`, `ghcr.io/stakwork/stadeum-ops`), the rest pinned to a version. A box pulls and never builds.
- `stack/dev.yml` is local mode: plain http, stadeum-ui at `http://stadeum.localhost` and strut at `http://strut.stadeum.localhost`, signed in with a password-less dev login. It builds stadeum-ui and ops from the checkout.
- Production: drop `-f stack/dev.yml` and set `HOST` and `ACME_EMAIL`. Caddy then serves `$HOST` (stadeum-ui) and `strut.$HOST` (strut) with certificates it fetches itself.
- strut must stay at `strut.$HOST`: the same site as stadeum-ui, so the strut frame's session cookie reaches it.
- bifrost, Neo4j and redis are internal: no port, no route.
- `bootstrap` (a one-shot service) makes the org's macaroon signing key in the `org` volume and registers it with bifrost. Re-run it any time: `docker compose ... run --rm bootstrap`.
- The mothership is mandatory: bifrost rejects any model call without a valid macaroon (401) or over a cap (402), and strut refuses an LLM step with no person or no delegation. These are fixed on in `stack/stadeum.yml`.
- An admin sets each provider's key on the Models page, which writes it to bifrost only, and picks the models people may use and the default (`docs/models.md`). strut has no key: it calls a model only through bifrost, on each person's delegation.
- `scripts/mothership-e2e.sh` proves it end to end (a fake provider is used unless bifrost holds an Anthropic key).
- **Calls.** A person talks to the assistant by voice on the Calls page, with a live transcript of both sides and the artifacts it hands over (opened through strut), end-to-end encrypted with a key their browser makes for each call, through a LiveKit server that carries audio it cannot read (`LIVEKIT_URL`, default `wss://livekit.sphinx.chat`; any LiveKit server works). The box reaches it outbound only. Calls are off until `.env` has `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (and `STRUT_VOICE_TOKEN`, from `scripts/init-env.sh`).

## Updates and backups

The `ops` container keeps the box: the only one with the Docker socket, and
with no port. An admin sets it up on two pages in stadeum-ui.

- **Updates.** In a daily window (default 03:00–05:00, in the admin's time
  zone), ops pulls strut + strut-browser (together: their Playwright
  versions must match) on strut's `stable` channel, and stadeum's release on
  its own: stadeum-ui and ops, and the stack files ops's image carries. If
  one moved, it drains strut and waits for its runs to finish (at most 30
  minutes; what still runs resumes after the restart), recreates what
  changed, checks its health, and puts the previous images and files back
  if it fails. A release is applied by the ops it brings. It moves every pin
  in its files (Caddy, Redis, the gateway), except Neo4j's: a release that
  upgrades Neo4j waits, whole, until the admin presses **Upgrade Neo4j** on
  the Updates page, and ops backs up first. Every 10 minutes ops asks the
  registry what each channel names (a `HEAD`, nothing pulled), and the page
  says an image is current only from that answer, with when it was given.
  The admin can turn updates off, check now, or update now. Old images go
  after each update: ops keeps what
  runs and the one before it (`…:ops-previous`), and says in the history
  what it removed and the space it freed.
- **Backups.** In the same window, before the updates: drain strut, stop the
  services whose files would tear (Neo4j community has no online dump), and
  snapshot every volume (but strut's downloaded models, fetched again on a
  restored box) and `.env` with restic, to S3 or S3-compatible
  storage (R2, MinIO), Azure Blob, GCS, B2, or a local folder for testing. A
  few minutes of downtime. Kept: 7 daily, 4 weekly, 12 monthly. restic's
  password is shown once, with a restore kit, to keep off the box.
- **Restore**, on a new box with the kit saved as `/root/restore.env`: the
  install restores the latest snapshot before it starts, with the old box's
  `.env` (pass `STADEUM_HOST=<name>` too for another name than the old box's).

```bash
curl -fsSL https://raw.githubusercontent.com/stakwork/stadeum/main/scripts/install.sh | sudo STADEUM_RESTORE=/root/restore.env bash
```

`scripts/backup-restore-e2e.sh` proves it end to end: data in strut,
stadeum-ui and Neo4j, a backup, every volume wiped and `.env` regenerated, a
restore, and the same data back. `scripts/release-e2e.sh` proves releases:
one applied to a running box, a broken one rolled back, and one that moves
Neo4j held until Upgrade Neo4j. `docs/stack-spec.md` ("ops") has how they
work.

## Decisions

- One compose file is the deployment, on stock images: strut's own, Caddy,
  the stock Neo4j. `docs/stack-spec.md` has each service and why.
- Lightning and legacy images (jarvis, boltwall, hermes, …) are stripped.
  Lightning can return later as an off-by-default compose profile.
- No swarm dashboard. stadeum-ui is the only UI.
- Hive is not part of the stack. Proven work graduates into Strut as a step
  or an app.

## stadeum-ui (`ui/`)

Next.js 15, Auth.js v5, Prisma on SQLite (`/data/stadeum.db` in the
container), port 3000. The shell is vertical-neutral: sign-in, the person,
Organisation (Members, Status, Apps, Models, Branding, Updates, Backups;
admins only) and strut's apps.

- Apps: `ui/src/lib/apps.ts` reads strut's `GET /apps` through the strut
  client (`ui/src/lib/strut/client.ts`) and orders them: the assistant,
  Jamie (`strut/jamie`, which strut seeds on every server), first, then the
  apps pinned as tabs, then the rest by title. `strut/views`, the component
  library other apps import, is left out: the listing cannot tell a library
  from a page.
- Opening one frames strut's own host page showing the app alone,
  `{STRUT_PUBLIC_URL}/?ticket=…&app=<name>&solo=1&embed_origin=<stadeum's origin>`,
  signed in as the person with a ticket minted per page load
  (`POST /auth/ticket`, with the person's role: strut opens its operator
  console to an admin's session and only their apps to a member's). The frame fills the page beside the rail, with no
  title or margin of stadeum's. It opens in the theme stadeum shows
  (`&theme=light|dark`, which strut reads once), so a theme switch reloads
  it with a fresh ticket. Jamie is the home, `/`. Every other app is
  at `/apps/<its name, encoded>` (`/apps/acme%2Flegal`). Without Jamie, the
  home lists the apps.
- The app's own deep link, `input`, rides in stadeum's URL:
  `/?input=session%3D<id>` opens that conversation, and the app's
  `strut:location` reports update it.
- Organisation → Apps (`/apps`, admins only) manages what strut serves: per
  app, what is live (every publish, or a held version), its drafts, its
  pin and its usage warnings. An app's versions
  (`/apps/<name>/versions`) can be viewed by the admin alone
  (`<name>@vN`), made live, restored, or followed again from the newest
  publish. Every change asks first and says what everyone will get. The
  role is checked on the server, and every call goes through the strut
  client with the deployment key, the admin named as the actor. The states
  and wording are strut's (`ui/src/lib/app-versions.ts`, ported from its
  `web/src/app-versions.ts`). A seeded app (Jamie) is read-only.
- Organisation → Models (`/models`, admins only, `ui/src/lib/models/`):
  each provider's key, pasted once and written to bifrost's config store
  and nowhere else (it replaces the provider's empty `env.*` slot under its
  name, so it survives restarts), with bifrost's check of it. Then the
  models people may use, from strut's `GET /llm/models`, and the default.
  Until an admin saves a list, every catalog model of a provider with a key
  is allowed. Saving narrows every person's virtual key to the list (the
  gateway refuses anything else) and writes `STRUT_MODELS` and
  `STRUT_DEFAULT_MODEL` to strut's settings, where Jamie's picker and the
  shipped workflows read them. The background pass repeats this every six
  hours, with the gateway's 60-day log retention. Maple (through the
  `maple` proxy in the stack) and Numes are set up on their first key,
  and "Another provider" adds any OpenAI-compatible API by name, address
  and key: each is a custom provider in the gateway, its models named
  `<provider>/<id>`. The gateway's price table (`PUT /_plugin/pricing`)
  gets Maple's and Numes' rates from strut's catalog and an added
  provider's from the price typed beside the model, so their calls count
  against the caps. `docs/models.md` has the why.
- Organisation → Branding (`/branding`, admins only) sets the look of every
  app strut serves: one color (and its dark-theme twin), the corners and
  the font. Strut keeps the brand and hands it to every app page as MCP
  Apps style variables (`GET`/`PUT /brand`, strut `specs/API.md` §14.12),
  so no app is rebuilt; stadeum keeps no copy. The preview draws the kit's
  components from strut's own variables (`ui/src/lib/brand.ts`), and a
  change shows in an app the next time it loads.
- Sign-in: Microsoft Entra ID and Google when their `AUTH_*` vars are set;
  `STADEUM_DEV_LOGIN=1` adds a password-less email login for local work.
  The first person becomes admin; others need an invite or an email at
  `STADEUM_ALLOWED_DOMAINS`.
- Mothership: `ui/src/lib/mothership/` (ported from Hive). It calls
  `ensureOrgTrust()` at install and `ensureDelegation(user)` per person;
  sign-in calls the latter too, and a 6-hourly pass renews every delegation.
  The org key is made by the stack's `bootstrap` service, not the UI: see
  "Org identity file" in `docs/mothership-spec.md` (the UI must import it).
- Config: `ui/.env.example`. Local run without the stack:

```bash
cd ui && cp .env.example .env   # then set AUTH_SECRET, STADEUM_ENCRYPTION_KEY, STADEUM_DEV_LOGIN=1, URLs → 127.0.0.1:4555/{bifrost,strut,neo4j}
```

```bash
cd ui && npm install && npx prisma migrate deploy
```

```bash
cd ui && npm run fake-stack    # bifrost, strut and neo4j fakes on :4555
```

```bash
cd ui && npm run dev
```

## License

Apache-2.0. See `LICENSE`.
