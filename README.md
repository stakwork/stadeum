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
| `stack/` | `stadeum.yml` (docker compose): caddy, neo4j, strut + strut-browser, bifrost + redis (LLM gateway), stadeum-ui. `caddy/Caddyfile`: the routes |
| `stack/bootstrap/` | First-boot setup: the org signing key and its registration with bifrost |
| `ui/` | stadeum-ui: single sign-on, members, status, per-person model access, app launcher |
| `scripts/` | Env setup, the end-to-end gateway check |
| `docs/` | Stack and gateway specs |

## Run the stack

```bash
scripts/init-env.sh            # .env with generated secrets; then fill in provider keys
```

```bash
docker compose --env-file .env -f stack/stadeum.yml -f stack/dev.yml up -d --wait
```

- `stack/dev.yml` is local mode: plain http, stadeum-ui at `http://stadeum.localhost` and strut at `http://strut.stadeum.localhost`, signed in with a password-less dev login.
- Production: drop `-f stack/dev.yml` and set `HOST` and `ACME_EMAIL`. Caddy then serves `$HOST` (stadeum-ui) and `strut.$HOST` (strut) with certificates it fetches itself.
- strut must stay at `strut.$HOST`: the same site as stadeum-ui, so the strut frame's session cookie reaches it.
- bifrost, Neo4j and redis are internal: no port, no route.
- `bootstrap` (a one-shot service) makes the org's macaroon signing key in the `org` volume and registers it with bifrost. Re-run it any time: `docker compose ... run --rm bootstrap`.
- The mothership is mandatory: bifrost rejects any model call without a valid macaroon (401) or over a cap (402), and strut refuses an LLM step with no person or no delegation. These are fixed on in `stack/stadeum.yml`.
- Provider keys go to bifrost only. strut has none: it calls a model only through bifrost, on each person's delegation.
- `scripts/mothership-e2e.sh` proves it end to end (a fake provider is used unless `ANTHROPIC_API_KEY` is set).

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
Organisation (Members, Status; admins only) and strut's apps.

- Apps: `ui/src/lib/apps.ts` reads strut's `GET /apps` through the strut
  client (`ui/src/lib/strut/client.ts`) and orders them: the assistant,
  Jamie (`strut/jamie`, which strut seeds on every server), first, then the
  apps pinned as tabs, then the rest by title. `strut/views`, the component
  library other apps import, is left out: the listing cannot tell a library
  from a page.
- Opening one frames strut's own host page showing the app alone,
  `{STRUT_PUBLIC_URL}/?ticket=…&app=<name>&solo=1&embed_origin=<stadeum's origin>`,
  signed in as the person with a ticket minted per page load
  (`POST /auth/ticket`). The frame fills the page beside the rail, with no
  title or margin of stadeum's. Jamie is the home, `/`. Every other app is
  at `/apps/<its name, encoded>` (`/apps/acme%2Flegal`). Without Jamie, the
  home lists the apps.
- The app's own deep link, `input`, rides in stadeum's URL:
  `/?input=session%3D<id>` opens that conversation, and the app's
  `strut:location` reports update it.
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
