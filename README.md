<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <img src="docs/logo-light.svg" width="72" height="72" alt="stadeum logo">
</picture>

# stadeum

A private AI workspace your team runs in its own cloud. It turns your
documents into a knowledge graph, runs Strut workflows and apps on it, and
routes every model call through a gateway with a key and a spending cap per
person. Your data, keys and models stay in your account.

## Layout

| Path | What |
| --- | --- |
| `stack/` | `stadeum.yml` (docker compose): caddy, neo4j, strut + strut-browser, bifrost + redis (LLM gateway), stadeum-ui, ops. `caddy/Caddyfile`: the routes |
| `stack/bootstrap/` | First-boot setup: the org signing key and its registration with bifrost |
| `ui/` | stadeum-ui: single sign-on, members, status, updates, backups, per-person model access, app launcher |
| `ops/` | stadeum-ops: image updates and backups (the Docker socket's one holder, no port) |
| `.github/workflows/` | Checks; stadeum's images, published from main and promoted to `stable` |
| `scripts/` | Env setup, the end-to-end gateway check, the backup-and-restore proof |
| `docs/` | Stack and gateway specs |

## Run the stack

```bash
scripts/init-env.sh            # .env with generated secrets; then fill in provider keys
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
- Provider keys go to bifrost only. strut has none: it calls a model only through bifrost, on each person's delegation.
- `scripts/mothership-e2e.sh` proves it end to end (a fake provider is used unless `ANTHROPIC_API_KEY` is set).

## Updates and backups

The `ops` container keeps the box: the only one with the Docker socket, and
with no port. An admin sets it up on two pages in stadeum-ui.

- **Updates.** In a daily window (default 03:00–05:00, in the admin's time
  zone), ops pulls strut + strut-browser (together: their Playwright
  versions must match) and stadeum-ui + ops on their `stable` channels. If
  one moved, it drains strut and waits for its runs to finish (at most 30
  minutes; what still runs resumes after the restart), recreates it, checks
  its health, and puts the old image back if it fails. The admin can turn
  updates off, check now, or update now. Neo4j, Caddy, Redis and the gateway
  move only when a person moves them.
- **Backups.** In the same window, before the updates: drain strut, stop the
  services whose files would tear (Neo4j community has no online dump), and
  snapshot every volume and `.env` with restic, to S3 or S3-compatible
  storage (R2, MinIO), Azure Blob, GCS, B2, or a local folder for testing. A
  few minutes of downtime. Kept: 7 daily, 4 weekly, 12 monthly. restic's
  password is shown once, with a restore kit, to keep off the box.
- **Restore**, on a fresh box with the kit saved as `restore.env`:

```bash
scripts/init-env.sh
```

```bash
docker compose --env-file .env -f stack/stadeum.yml run --rm --env-from-file restore.env ops restore
```

```bash
docker compose --env-file .env -f stack/stadeum.yml up -d --wait
```

`scripts/backup-restore-e2e.sh` proves it end to end: data in strut,
stadeum-ui and Neo4j, a backup, every volume wiped and `.env` regenerated, a
restore, and the same data back. `docs/stack-spec.md` ("ops") has how it
works.

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
Organisation (Members, Status, Updates, Backups; admins only), an Apps launcher and Recent activity.
Everything else is an app from the registry in `ui/src/lib/apps.ts`
(`{id, name, description, entry}`). v1 ships with no apps. An entry with
`strutApp: { wf }` frames strut's UI there instead, signed in as the person
with a one-use ticket (`ui/src/lib/strut/client.ts`).

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
