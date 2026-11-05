# Stack spec

Source of truth for `stack/stadeum.yml`: what each service is, what it is
given, and why. Refs to other repos are `file` or `file:line` at the commit
named.

## Containers

`docker compose -f stack/stadeum.yml [-f stack/dev.yml] up` starts exactly
these; there are no profiles. The Status page in stadeum-ui lists the same
eight (`ui/src/lib/status.ts`, `SERVICES`).

| Service | Image | Role | Status page check |
| --- | --- | --- | --- |
| `caddy` | `caddy:2.11.8-alpine` | TLS and routing, the only published ports: `$HOST` → stadeum-ui, `strut.$HOST` → strut | None (stadeum-ui never calls it) |
| `neo4j` | `neo4j:5.26.32` | The graph: strut's workflows, steps and knowledge graph; bifrost's agent catalog | `GET {NEO4J_HTTP_URL}/` |
| `redis` | `redis:7.4.2-alpine` | bifrost's plugin state | None (stadeum-ui never calls it) |
| `bifrost` | `ghcr.io/stakwork/stakgraph-gateway` | Model gateway: provider keys, a virtual key and a cap per person | `/_plugin/trust/status` |
| `strut-browser` | `ghcr.io/stakwork/strut-browser:1.63.0` | The Playwright server strut's browser steps drive | None (stadeum-ui never calls it) |
| `strut` | `ghcr.io/stakwork/strut:7498d21` | The product: workflows, apps, the assistant | `GET {STRUT_URL}/health` with the key |
| `bootstrap` | `node:22.20.0-alpine` | One shot: org signing key + trust registration | Org key registered with bifrost, same key as stadeum-ui's |
| `stadeum-ui` | built from `ui/` | Sign-in, the person, Members, Status | Running (it serves the page) |

stadeum-ui has no Docker socket, so it cannot see container state; each
row's health is the HTTP check it already makes, and the rest show "Not
checked".

## Conventions

- Services reach each other by their compose service name on the project's
  network (`stadeum_default`): `http://strut:3000`, `http://bifrost:8181`,
  `bolt://neo4j:7687`. strut and strut-browser also share `stadeum_browser`.
- Only caddy publishes host ports (`HTTP_PORT`, `HTTPS_PORT`).
- `restart: unless-stopped` on every long-running service.
- One named volume per service that keeps state, named after it.
- Every image is pinned to a version, except bifrost: the gateway publishes
  no versioned tags yet (`BIFROST_TAG=latest`).

## Services

### caddy
- `stack/caddy/Caddyfile`, two sites: `{SCHEME}://{HOST}` → `stadeum-ui:3000`
  and `{SCHEME}://strut.{HOST}` → `strut:3000`. The compose file sets
  `SCHEME=https`, `HOST` and `ACME_EMAIL` in its environment.
- **https:** Caddy fetches and renews the certificates (Let's Encrypt; also
  ZeroSSL when `ACME_EMAIL` is set) and redirects http to https. Ports 80
  and 443 must reach the box from the internet; 443/udp carries HTTP/3.
  Volume `caddy` at `/data` keeps the certificates and the ACME account.
- **strut:** `flush_interval -1`, so run tails and the chat (SSE) pass every
  chunk on at once. WebSocket upgrades (`/rooms`, `/channels`,
  `/audio/stream`) pass through `reverse_proxy` as they are. Precedent:
  strut `deploy/voice/Caddyfile`.
- **Same site.** strut's session cookie is `SameSite=Lax`, so the browser
  sends it to the framed UI only when strut and stadeum-ui are the same site:
  strut at `strut.$HOST`, under `$HOST`. Keep that layout.
- **Local (`stack/dev.yml`):** `SCHEME=http`, so Caddy serves port 80 only and
  fetches no certificate. `HOST` stays `stadeum.localhost`: every
  `*.localhost` resolves to the machine, and with a dot in it
  `strut.stadeum.localhost` is the same site as `stadeum.localhost`. Bare
  `localhost` and `strut.localhost` are two sites (`localhost` has no
  registrable domain), and the frame's cookie would not reach strut.
- No Docker socket: the routes are in the Caddyfile, not in labels.
- **bifrost is not routed.** strut and stadeum-ui call it on the network and
  nothing outside the box does. Its admin UI is reached from inside, e.g. a
  local override that publishes `127.0.0.1:8181:8181`.

### neo4j
- The stock `neo4j:5.26.32`: no APOC, no GDS, no index initializers. 5.26 is
  the last 5.x (the LTS) and the patch strut's own `docker-compose.yml` pins.
- **PINNED.** Neo4j cannot open a store a newer version wrote, so it moves
  only when a person moves it, after a backup.
- Who needs what from it:
  - strut's graph backend (`STRUT_WORKSPACE_BACKEND=graph`) needs fulltext
    and vector indexes (5.13+) and makes its own at boot.
  - bifrost keeps its agent catalog and evals in it, over the HTTP Cypher
    endpoint (`NEO4J_HTTP_URL` + `/db/neo4j/tx/commit`, user `neo4j`,
    `NEO4J_PASSWORD`). Its schema is three `CREATE … IF NOT EXISTS`
    statements run before the first write (stakgraph
    `gateway/internal/graphclient/schema.go`), and no query in
    `gateway/internal` calls APOC or GDS (stakgraph `b8f16c5b`). Nothing on
    the inference path reads the catalog.
  - So nothing in the stack needs sphinx-swarm's plugins or `apoc.initializer`
    indexes.
- Memory: `NEO4J_HEAP_INITIAL/HEAP_MAX/PAGECACHE/TX_TOTAL_MAX/TX_MAX`,
  defaults `1g/1g/1g/1g/512m` (laptop sizes; raise them on a real box).
- Private: no published port, no route.

### redis
- `redis:7.4.2-alpine`, `redis-server --appendonly yes`, volume `/data`,
  private. Only bifrost uses it (`BIFROST_PLUGIN_REDIS_URL`).

### bifrost (mothership / LLM gateway)
- `ghcr.io/stakwork/stakgraph-gateway`, port 8181 (a wrapper that proxies to
  bifrost-http on 127.0.0.1:8080). Do NOT set `APP_PORT`/`APP_HOST`.
- Volume `/app/data`.
- Env: `BIFROST_ADMIN_USER=admin`, `BIFROST_ADMIN_PASS` (bcrypted on first
  boot into `/app/data`), `BIFROST_PROVISIONING_TOKEN=${SHARED_API_TOKEN}`,
  `BIFROST_PLUGIN_REDIS_URL`, `NEO4J_HTTP_URL`, `NEO4J_PASSWORD`, and the
  provider keys (OPENAI/ANTHROPIC/OPENROUTER/GOOGLE/XAI): the only place they
  live.
- `BIFROST_PLUGIN_ENFORCE_MACAROONS` and `BIFROST_PLUGIN_ENFORCE_BUDGETS` are
  fixed `true`: a call without a valid macaroon is a 401, one over a cap a
  402. `docs/mothership-spec.md` has the contract.

### strut-browser
- `ghcr.io/stakwork/strut-browser:${STRUT_BROWSER_TAG:-1.63.0}`: the
  Playwright server behind strut's `browser/*` steps. The builder looks at
  the apps it makes through it.
- Its tag stays on strut's `playwright-core` major.minor (the server refuses
  any other), so it moves with `STRUT_IMAGE_TAG`.
- It sits on its own network (`browser`) that strut joins: a page it loads can
  reach strut, but not Neo4j, bifrost or stadeum-ui.
- `BROWSER_WS_PATH`, generated by `scripts/init-env.sh`, is its one door; a
  page it loads must not be able to guess it.

### strut
- `ghcr.io/stakwork/strut:${STRUT_IMAGE_TAG:-7498d21}`, amd64 + arm64, port
  3000. A published commit tag until strut promotes a `stable` channel
  (stakwork/strut#527 added it); then the default becomes `stable`.
- Based on strut's own `docker-compose.yml`:
  `STRUT_WORKSPACE_BACKEND=graph` with `NEO4J_URI=bolt://neo4j:7687`,
  `NEO4J_USER`, `NEO4J_PASSWORD`; `STRUT_GRAPH_SEED_ONTOLOGY=1`;
  `STRUT_WORKSPACE=/data/workspace`, `STRUT_MODEL_DIR=/data/models`;
  `BROWSER_WS_URL=ws://strut-browser:3000` + `BROWSER_WS_PATH`.
- `STRUT_API_KEY=${SHARED_API_TOKEN}`: every route needs it, or a session
  cookie. It never reaches a browser.
- `STRUT_SECRET_KEY`, generated: encrypts strut's secret stores
  (`secrets.json`, and the delegations in `mothership.json`). Losing it loses
  what they hold; the backup must keep it.
- `STRUT_MOTHERSHIP=1` mounts `/llm/delegations`; `STRUT_MOTHERSHIP_REQUIRED=1`
  makes a model call with nobody to bill a step error. Both are fixed on, like
  bifrost's flags.
- No provider keys and no `LLM_PROVIDER`: strut calls a model only through
  bifrost, on the caller's delegation, so it boots and runs with none.
  `EXA_API_KEY` is optional (web search on a routed call; without it a routed
  call has `web_fetch` only).
- `STRUT_PUBLIC_URL=https://strut.${HOST}`: the base of the links strut hands
  a caller outside its UI (MCP artifact links, `ui` deep links).
- Volumes: `strut-workspace` (runs, chats, artifacts, apps, the secret
  stores) and `strut-models` (the embedding and speech models, fetched on
  first boot). strut's uv cache is not kept: it is a cache.
- Healthcheck: `GET /health`, which answers `{ ok }` without the key.
  `start_period` 180 s: the first boot seeds the schema and ontology and
  fetches the embedding model before it listens.
- strut's default server empties its own `process.env` after boot
  (`STRUT_ENV_SCRUB`), so a step cannot read the deployment key.

### bootstrap
- `node:22.20.0-alpine`, runs `stack/bootstrap/org-identity.mjs` once: the org
  signing key in the `org` volume, and its registration with bifrost.
  Idempotent; `docker compose … run --rm bootstrap` re-runs it.

### stadeum-ui
- Built from `ui/`, port 3000, volume `/data` (`stadeum.db`), the `org`
  volume read-only.
- `STRUT_URL=http://strut:3000` (every API call) and
  `STRUT_PUBLIC_URL=https://strut.${HOST}` (the frame).
- One strut client, `ui/src/lib/strut/client.ts`, with
  `Authorization: Bearer <SHARED_API_TOKEN>`: `GET /health` (Status),
  `GET/PUT/DELETE /llm/delegations[/:actor]` (each person's delegation),
  `PUT /actors/:actor/secrets/:NAME`, `POST /auth/ticket` (the frame).
- **The frame.** Per page load the server mints a sign-in ticket for the
  person (`POST /auth/ticket { actor }` → `{ ticket, expiresAt }`, good once
  for 60 s) and frames
  `{STRUT_PUBLIC_URL}/?ticket=<ticket>&embed_origin=<stadeum origin>[&wf=&run=]`.
  strut's UI trades the ticket for its own session cookie as that person and
  takes it off the URL (strut `specs/API.md` §13.1).

## The shared token

`SHARED_API_TOKEN` is the deployment key: bifrost's
`BIFROST_PROVISIONING_TOKEN` (Bearer on `/_plugin/*`) and strut's
`STRUT_API_KEY`, which also signs strut's session cookies and tickets
(rotating it ends every session). `scripts/init-env.sh` generates it. In
sphinx-swarm it was boltwall's `stakwork_secret`.

## Where it came from

The stack began as sphinx-swarm's containers (`dd0f132d`) under compose.
Step 2 replaced repo2graph (stakgraph-mcp with Strut embedded at `/lab`,
behind mcp's `/mint-token`) with strut's own image, Traefik and its Docker
socket with Caddy, the swarm's network and `<name>.sphinx` hostnames with
compose's own, and the swarm's Neo4j (5.19 with APOC, GDS and index
initializers) with the stock image strut needs. repo2graph's arm64 image
crash-looped, and its lab would not boot without a provider key.

## Still open

- The node `created_by` property: `graph/create-node` passes `ctx.actor`, but
  a verify run's node came back with `created_by = NULL` although the run's
  actor was set (seen under repo2graph). Check before relying on it.
