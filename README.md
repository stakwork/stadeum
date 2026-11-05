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
| `stack/` | `stadeum.yml` (docker compose): traefik, neo4j, repo2graph (Strut + mcp + stakgraph), bifrost + redis (LLM gateway), stadeum-ui |
| `stack/bootstrap/` | First-boot setup: the org signing key and its registration with bifrost |
| `ui/` | stadeum-ui: single sign-on, members, status, per-person model access, app launcher |
| `scripts/` | Env setup, neo4j plugins, the end-to-end gateway check |
| `docs/` | Stack and gateway specs |

## Run the stack

```bash
scripts/init-env.sh            # .env with generated secrets; then fill in provider keys
scripts/fetch-neo4j-plugins.sh # APOC core (lang3 stripped) + extended, GDS 2.9.0
docker compose --env-file .env -f stack/stadeum.yml -f stack/dev.yml up -d --wait
```

- `stack/dev.yml` is local mode: plain http on `localhost`, with the Strut lab at `http://repo2graph.localhost/lab/` and bifrost at `http://bifrost.localhost`.
- Production: drop `-f stack/dev.yml` and set `HOST` and `ACME_EMAIL`. Traefik then serves `repo2graph.$HOST` and `bifrost.$HOST` over Let's Encrypt.
- stadeum-ui is built from `ui/` and served at `$HOST` (`localhost` in dev).
- `bootstrap` (a one-shot service) makes the org's macaroon signing key in the `org` volume and registers it with bifrost. Re-run it any time: `docker compose ... run --rm bootstrap`.
- The mothership is mandatory: bifrost rejects any model call without a valid macaroon (401) or over a cap (402), and Strut refuses an LLM step with no person or no delegation. These are fixed on in `stack/stadeum.yml`.
- Provider keys go to bifrost only. repo2graph gets a placeholder and routes its own model calls to bifrost, which refuses them.
- `scripts/mothership-e2e.sh` proves it end to end (a fake provider is used unless `ANTHROPIC_API_KEY` is set).

## Decisions

- Containers run under docker compose, using the same images and settings
  sphinx-swarm generates (source: sphinx-swarm `dd0f132d`). The Rust
  orchestrator is not ported yet.
- Lightning and legacy images (jarvis, boltwall, hermes, …) are stripped.
  Lightning can return later as an off-by-default compose profile.
- No swarm dashboard. stadeum-ui is the only UI.
- Hive is not part of the stack. Proven work graduates into Strut as a step
  or an app.

## stadeum-ui (`ui/`)

Next.js 15, Auth.js v5, Prisma on SQLite (`/data/stadeum.db` in the
container), port 3000. The shell is vertical-neutral: sign-in, the person,
Organisation (Members, Status; admins only), an Apps launcher and Recent activity.
Everything else is an app from the registry in `ui/src/lib/apps.ts`
(`{id, name, description, entry}`). v1 ships with no apps. An entry with
`strutApp: { wf }` opens the Strut UI there instead, with a per-person
`/mint-token` JWT.

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
cd ui && cp .env.example .env   # then set AUTH_SECRET, STADEUM_ENCRYPTION_KEY, STADEUM_DEV_LOGIN=1, URLs → 127.0.0.1:4555/{bifrost,mcp,neo4j}
```

```bash
cd ui && npm install && npx prisma migrate deploy
```

```bash
cd ui && npm run fake-stack    # bifrost, mcp/Strut and neo4j fakes on :4555
```

```bash
cd ui && npm run dev
```

## License

Apache-2.0. See `LICENSE`.
