# Stack spec

Source of truth for `stack/stadeum.yml`: what each service is, what it is
given, and why. Refs to other repos are `file` or `file:line` at the commit
named.

## Containers

`docker compose -f stack/stadeum.yml [-f stack/dev.yml] up` starts exactly
these; there are no profiles. The Status page in stadeum-ui lists them all
but maple (`ui/src/lib/status.ts`, `SERVICES`).

| Service | Image | Role | Status page check |
| --- | --- | --- | --- |
| `caddy` | `caddy:2.11.8-alpine` | TLS and routing, the only published ports: `$HOST` → stadeum-ui, `strut.$HOST` → strut | None (stadeum-ui never calls it) |
| `neo4j` | `neo4j:5.26.32` | The graph: strut's workflows, steps and knowledge graph; bifrost's agent catalog | `GET {NEO4J_HTTP_URL}/` |
| `redis` | `redis:7.4.2-alpine` | bifrost's plugin state | None (stadeum-ui never calls it) |
| `bifrost` | `ghcr.io/stakwork/stakgraph-gateway:v0.4.399` | Model gateway: provider keys, a virtual key and a cap per person, the price table | `/_plugin/trust/status` |
| `maple` | `ghcr.io/mapleprivacylabs/maple-proxy:0.4.5` | Maple's inference proxy: encrypts each request to Maple's enclave. The gateway's `maple` provider | None (stadeum-ui never calls it) |
| `strut-browser` | `ghcr.io/stakwork/strut-browser:stable` | The Playwright server strut's browser steps drive | None (stadeum-ui never calls it) |
| `strut` | `ghcr.io/stakwork/strut:stable` | The product: workflows, apps, the assistant | `GET {STRUT_URL}/health` with the key |
| `voice` | `sphinxlightning/sphinx-voice:stable` | A person's voice call with the assistant (sphinx-voice's 1:1 mode): the LiveKit room and the agent in it | None (stadeum-ui never calls it) |
| `treasury` | `ghcr.io/stakwork/sphinx-daemon:stable` | The Lightning wallet strut sells paid public runs through: a Sphinx daemon on an account of its own | None (stadeum-ui never calls it) |
| `bootstrap` | `node:22.20.0-alpine` | One shot: org signing key + trust registration | Org key registered with bifrost, same key as stadeum-ui's |
| `stadeum-ui` | `ghcr.io/stakwork/stadeum-ui:stable` (built from `ui/`) | Sign-in, the person, Calls, Members, Packages, Status, Updates, Backups; Earnings is strut's app (`strut/earnings`) framed among them for an admin | Running (it serves the page) |
| `ops` | `ghcr.io/stakwork/stadeum-ops:stable` (built from `ops/`, carrying `stack/`) | stadeum's releases, strut's updates, backups; the Docker socket | Reported in the last 3 minutes |

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
- Every image is pinned to a version or follows a channel, never `latest`.
  ops moves a service whose `stadeum.ops.update` label names a group, on the
  channel its tag names (`stable`). Every other pin is in the stack files,
  which are a release's: it moves when a release changes it, and Neo4j's
  only when an admin confirms it, after a backup.
- stadeum's own images are published by `.github/workflows/publish-images.yml`
  (amd64 + arm64, tagged with the short commit sha and `latest`) when what
  goes into one changes on main: `ui/` for stadeum-ui; `ops/`, `stack/`,
  `.env.example` or `scripts/init-env.sh` for stadeum-ops, which carries
  them. `promote-images.yml` moves `stable` for both to a commit's images,
  as strut's `promote-image.yml` does for strut's: that is a release.
  `scripts/promote.sh strut|stadeum` runs either on main's newest images
  and waits for it; `scripts/promote.sh voice` moves sphinx-voice's `stable`
  to its newest release (below, "voice"), and `scripts/promote.sh daemon`
  the treasury's to stakwork/sphinx master's newest image (below,
  "treasury").
  `stack/dev.yml` builds them from the checkout instead (`stadeum-ui:dev`,
  `stadeum-ops:dev`), and ops never pulls a service that has a build.
- A box's own changes go in `stack/local.yml`: a compose override beside
  `stadeum.yml` that ops and `scripts/install.sh` add last when it is there,
  and that no release writes. `.env` is the box's too.

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
- **PINNED, and held.** Neo4j cannot open a store a newer version wrote.
  Its label `stadeum.ops.upgrade: confirm` makes ops hold a release that
  changes its image until an admin presses Upgrade Neo4j on the Updates
  page; ops then backs up and applies it ("ops", below).
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
- `ghcr.io/stakwork/stakgraph-gateway:${BIFROST_TAG:-v0.4.399}`, amd64 +
  arm64, port 8181 (a wrapper that proxies to bifrost-http on
  127.0.0.1:8080). Do NOT set `APP_PORT`/`APP_HOST`. Its tags are
  stakgraph's releases; `v0.4.399` is stakgraph `c1d1645f`, the first
  published for arm64 too (stakwork/stakgraph#1847). The runtime price
  table (`PUT /_plugin/pricing`, stakwork/stakgraph#1844) came in
  `v0.4.398`. A release that changes the pin moves it (`BIFROST_TAG` in
  `.env` pins a box's).
- Volume `/app/data`.
- Env: `BIFROST_ADMIN_USER=admin`, `BIFROST_ADMIN_PASS` (bcrypted on first
  boot into `/app/data`), `BIFROST_PROVISIONING_TOKEN=${SHARED_API_TOKEN}`,
  `BIFROST_PLUGIN_REDIS_URL`, `NEO4J_HTTP_URL`, `NEO4J_PASSWORD`. No
  provider key: an admin sets each on stadeum's Models page, which writes it
  to bifrost's config store, the only place it lives (`docs/models.md`).
- stadeum-ui keeps bifrost's request log (prompts included) 60 days, not the
  image's 365, through bifrost's `PUT /api/config`.
- `BIFROST_PLUGIN_ENFORCE_MACAROONS` and `BIFROST_PLUGIN_ENFORCE_BUDGETS` are
  fixed `true`: a call without a valid macaroon is a 401, one over a cap a
  402. `docs/mothership-spec.md` has the contract.

### maple
- `ghcr.io/mapleprivacylabs/maple-proxy:${MAPLE_PROXY_TAG:-0.4.5}`, port 8080
  on the network only: no published port, no route in Caddy. It reads each
  prompt in plaintext and encrypts it to Maple's attested enclave.
- The gateway holds it as the OpenAI-compatible custom provider `maple`
  (`http://maple:8080`, `allow_private_network`), which stadeum-ui adds
  when an admin sets Maple's key on the Models page. Until then nothing
  calls it. It holds no key: the gateway sends Maple's on each request.
- `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, 256 MB. No state, so
  no backup label; pinned, so a release that changes the pin moves it. It
  passes Maple's stream through, `[DONE]` included, so the gateway needs
  none of its stream flags for it (stakwork/stakgraph#1844).

### strut-browser
- `ghcr.io/stakwork/strut-browser:${STRUT_BROWSER_TAG:-stable}`: the
  Playwright server behind strut's `browser/*` steps. The builder looks at
  the apps it makes through it.
- Its version must match strut's `playwright-core` major.minor (the server
  refuses any other). strut's `promote-image.yml` moves both `stable` tags
  together, and ops moves the two containers together (group `strut`). A
  pinned strut (`STRUT_IMAGE_TAG=2fe953a`) needs the browser pinned to the
  version that commit uses (`STRUT_BROWSER_TAG=1.63.0`).
- It sits on its own network (`browser`) that strut joins: a page it loads can
  reach strut, but not Neo4j, bifrost or stadeum-ui.
- `BROWSER_WS_PATH`, generated by `scripts/init-env.sh`, is its one door; a
  page it loads must not be able to guess it.

### strut
- `ghcr.io/stakwork/strut:${STRUT_IMAGE_TAG:-stable}`, amd64 + arm64, port
  3000. `stable` is the channel strut's promote workflow moves
  (stakwork/strut#527); ops follows it. A commit tag pins one image.
- Based on strut's own `docker-compose.yml`:
  `STRUT_WORKSPACE_BACKEND=graph` with `NEO4J_URI=bolt://neo4j:7687`,
  `NEO4J_USER`, `NEO4J_PASSWORD`;
  `STRUT_WORKSPACE=/data/workspace`, `STRUT_MODEL_DIR=/data/models`;
  `BROWSER_WS_URL=ws://strut-browser:3000` + `BROWSER_WS_PATH`.
- No Jarvis ontology: strut seeds its own types on Neo4j (Claim, Check,
  Evidence, Concept and its `Strut*` types, stakwork/strut#536) and agents
  and apps add theirs at runtime. Strut no longer carries Jarvis's library
  (stakwork/strut#543).
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
- `STRUT_HOST_CONFIG` (`stack/strut/host-config.json`) takes the model pin
  off strut's shipped workflows (job, orchestrator, builder), so they run on
  `STRUT_DEFAULT_MODEL`: the org default, which stadeum-ui writes to strut's
  settings with the allowed list (`STRUT_MODELS`). The env value is only
  what strut uses before stadeum-ui first sets it (`docs/models.md`).
  `EXA_API_KEY` is optional (web search on a routed call; without it a routed
  call has `web_fetch` only).
- `STRUT_PUBLIC_URL=https://strut.${HOST}`: the base of the links strut hands
  a caller outside its UI (MCP artifact links, `ui` deep links).
- Volumes: `strut-workspace` (runs, chats, artifacts, apps, the secret
  stores) and `strut-models` (`STRUT_MODEL_DIR`: the embedding model,
  fetched on first boot, and the speech models, fetched on first use: Kroko
  for speech to text, 57 MB, and Kokoro for text to speech, 350 MB; about
  500 MB in all). `strut-models` is not in the backup: a restored box
  fetches the models again. strut's uv cache is not kept: it is a cache.
- Calls: `STRUT_VOICE_URL=http://voice:8080` and `STRUT_VOICE_TOKEN`, the
  secret strut and the voice service share. strut's `POST /voice/calls`
  (`specs/API.md` §15.2) hands a person's call to the voice service as they
  sent it, with the person as `x-strut-actor` and the token as the bearer,
  and answers what the service answers; it logs and keeps nothing of
  either. The URL is set only when LiveKit's key, its secret and the token
  are all in `.env` (compose's `${…:+…}`); without them strut answers 503,
  no voice service is configured, and the Calls page says so.
- The wallet: `LIGHTNING_DAEMON_URL=http://treasury:8095`,
  `LIGHTNING_DAEMON_TOKEN` (the treasury's receive token) and
  `LIGHTNING_DAEMON_PAY_TOKEN` (its pay token), set only when `.env` has
  all three of the treasury's tokens (below, "treasury"). strut writes them
  into its encrypted `payments.json` at every boot (strut `specs/API.md`
  §18) and its wallet form shows the wallet as the deployment's.
- `STRUT_PACKAGES` (`.env`, empty by default): packages strut installs at
  first boot, a JSON list of `{ ref, url?, digest? }`, what `POST
  /packages/install` takes (`specs/API.md` §16). A listed package not
  installed yet is installed once strut is up, in the background; one
  already installed is left alone, so the list never updates anything. A
  failed install is logged and tried again at the next boot; it never holds
  the box. Stadeum passes the value through and knows nothing of what is
  in it. After boot, an admin installs and uninstalls on the Packages page
  (stadeum-ui, below).
- Healthcheck: `GET /health`, which answers `{ ok }` without the key.
  `start_period` 180 s: the first boot seeds the schema and ontology and
  fetches the embedding model before it listens.
- strut's default server empties its own `process.env` after boot
  (`STRUT_ENV_SCRUB`), so a step cannot read the deployment key.

### voice
- `sphinxlightning/sphinx-voice:${VOICE_TAG:-stable}` (Docker Hub), run as
  `node dist/one-to-one.js`: sphinx-voice's 1:1 mode, not the image's
  default meeting mode. Port 8080 on the network only (`LISTEN_HOST=0.0.0.0`):
  no published port, no route in Caddy. No state, so no volume and no backup
  label.
- **Its channel.** sphinx-voice publishes an image per GitHub Release
  (`:<version>` and `:latest`, amd64 + arm64 from 0.42: an amd64-only image
  crash-loops on an arm64 box without emulation, and `up --wait` fails with
  it). Its `promote-image.yml` copies a release's image to `:stable` by
  digest, and refuses one without both platforms; `scripts/promote.sh voice
  [version]` runs it for the newest release, or the one named, and checks
  the tag moved. The service speaks strut's turn and call contracts, so ops
  moves it in strut's group (`stadeum.ops.update: strut`): one drain, one
  health check, one rollback for the three. A release's tag in `VOICE_TAG`
  (`0.43`) pins a box's.
- **A call** (strut `plans/private-voice.md` §4.1). The person's browser
  makes a fresh 32-byte key and sends it, as base64, to stadeum-ui's
  `POST /api/calls`, which hands it to strut's `POST /voice/calls` as the
  person; strut hands it here (`POST /calls`, `STRUT_VOICE_TOKEN` as the
  bearer). The service names a fresh room (`sphinx.call.voice.<32 hex>`)
  and two random identities, mints the person's token (this room, the
  microphone, 10 minutes to join), joins the room itself with the key,
  and only then answers `{ url, room, token, identity, agent, encrypted:
  true, voice }`. Each turn runs strut's orchestrator as the person
  (`x-strut-actor`, on the session `<person>/voice/<call>`), so what is said
  lands in the assistant's conversation; speech goes through strut's
  `/audio/transcribe` and `/audio/speak` with the deployment key
  (`STRUT_API_KEY=${SHARED_API_TOKEN}`). strut posts a turn's end back to
  `CALLBACK_URL_BASE=http://voice:8080`.
- **End-to-end encrypted.** Both sides key the room with the key STRING's
  UTF-8 bytes (LiveKit's PBKDF2, salt `LKFrameEncryptionKey`), not its
  base64 decoding, with `encryption` (audio and data channel), not the
  legacy `e2ee`. The browser publishes without Opus RED and DTX. The
  LiveKit server, the network and any relay carry audio and text they
  cannot read; the room name, the identities and the agent's state
  attribute go over LiveKit's signaling in the clear. The key crosses TLS
  to the box, so whoever runs the box could read it there.
- **LiveKit** is reached outbound only, by this container and by the
  person's browser: `LIVEKIT_URL` (default `wss://livekit.sphinx.chat`, the
  central server; any LiveKit server works), `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`. A LiveKit key is admin over every room on its
  server; with the calls encrypted, one that leaks lets its holder join or
  end a call but not hear it. One key per box would make one revocable
  alone; livekit.sphinx.chat has no API to mint keys (they are static in
  its `livekit.yaml`), so for now a box takes whatever key its `.env`
  names. `scripts/install.sh` asks for them on a fresh box
  (`STADEUM_LIVEKIT_API_KEY`, `STADEUM_LIVEKIT_API_SECRET`).
- **Calls off.** Without LiveKit's key and secret, or the token, its config
  refuses to start, so the command waits instead (`sleep infinity`, under
  `init: true`) and says why in its log: the box comes up, strut has no
  `STRUT_VOICE_URL`, and the Calls page says no voice service is
  configured. `scripts/init-env.sh` generates `STRUT_VOICE_TOKEN`; a box
  from before calls gets one by running `scripts/install.sh` again, which
  runs the release's `init-env.sh` (a box has no `scripts/` of its own: the
  script is in ops's image).
- The voice turns ask for `VOICE_MODEL`, sphinx-voice's default `sonnet`,
  not the org's model from the Models page: what strut resolves for
  `sonnet`.

### treasury
- `ghcr.io/stakwork/sphinx-daemon:${TREASURY_TAG:-stable}` (stakwork/sphinx
  `wasm/daemon`): a Sphinx daemon on an account of its own, alias
  `treasury`, the wallet strut sells paid public runs through (strut
  `plans/paid-runs.md`, `specs/LIGHTNING.md`) and an admin withdraws from
  in strut's Earnings (`strut/earnings`, framed for an admin on stadeum's
  `/earnings`). Copied from sphinx-swarm's treasury. Why and what is
  open: `plans/treasury.md`.
- **Who calls it.** strut alone, at `http://treasury:8095`, on the stack's
  network: no published port, no route in the Caddyfile. It connects out to
  its LSP only (the image's default, `broker.v2.sphinx.chat`).
  `DAEMON_REPLY=none` and no service URL: it answers no mention and joins
  no tribe.
- **Three tokens**, generated by `scripts/init-env.sh`, all different (the
  daemon and strut each refuse two equal ones): `DAEMON_RECEIVE_TOKEN`
  (invoices, lookups, payments in, the balance) and `DAEMON_PAY_TOKEN`
  (those and `POST /pay`) go to strut; `DAEMON_ADMIN_TOKEN` (every route:
  posting and tribes as the account) to the treasury alone. Without all
  three the command waits (`sleep infinity`, under `init: true`) instead of
  making an account nothing uses, strut has no wallet, and the box runs as
  before. A box from before the treasury gets them by running
  `scripts/install.sh` again: it runs the release's `init-env.sh`, which
  keeps every value `.env` has, and starts the stack.
- **The risk accepted.** strut hides `LIGHTNING_*` from steps and empties
  its `process.env` after boot, but a shell in strut's container can still
  read the environment the process started with, so an agent can read the
  pay token and spend the balance. Accepted on purpose: the treasury holds
  only what paid runs brought in, and the seed is never in strut's
  container (`plans/treasury.md` §2).
- **`treasury` (`/data`) is the money**: the account's seed, made on the
  first start (never passed in), and `wallet.jsonl`, the payments it took.
  In the backup, stopped for the snapshot (`stadeum.ops.backup: stop`):
  `wallet.jsonl` is appended as payments settle. Lose the volume and every
  snapshot of it, and the sats are gone. `scripts/backup-restore-e2e.sh`
  checks the account (`GET /me`'s public key) comes back.
- **One container per account.** A second daemon on the same seed knocks
  the first off the broker, so a box restored from a backup must not run
  beside the box it came from. `scripts/install.sh`'s restore and the
  Backups page say so.
- **Its channel.** stakwork/sphinx's `publish-daemon.yml` pushes an image
  per change to `wasm/daemon` (or what it builds from) on master, tagged
  with the short commit sha and `latest`; `promote-daemon.yml` copies one
  to `stable`, by digest, and refuses one without both platforms.
  `scripts/promote.sh daemon [commit]` runs it on master's newest image.
  ops moves the treasury in strut's group: strut's payer and the daemon's
  wallet routes are one contract. A recreate keeps the volume.
- Every capability dropped, `no-new-privileges`; the image runs as its own
  `node` user. Healthcheck: `GET /health` (no token), or healthy at once
  while it waits for its tokens.

### bootstrap
- `node:22.20.0-alpine`, runs `stack/bootstrap/org-identity.mjs` once: the org
  signing key in the `org` volume, and its registration with bifrost.
  Idempotent; `docker compose … run --rm bootstrap` re-runs it. An update
  never starts it (`restart: "no"` makes it a one-shot to ops).

### stadeum-ui
- `ghcr.io/stakwork/stadeum-ui:${STADEUM_IMAGE_TAG:-stable}`, built from
  `ui/`, port 3000, volume `/data` (`stadeum.db`), the `org` volume
  read-only. Healthcheck: `GET /api/health` (the database answers).
- `STRUT_URL=http://strut:3000` (every API call) and
  `STRUT_PUBLIC_URL=https://strut.${HOST}` (the frame).
- One strut client, `ui/src/lib/strut/client.ts`, with
  `Authorization: Bearer <SHARED_API_TOKEN>`: `GET /health` (Status),
  `GET/PUT/DELETE /llm/delegations[/:actor]` (each person's delegation),
  `PUT /actors/:actor/secrets/:NAME`, `POST /auth/ticket` (the frame, and
  a call's artifact), `POST /voice/calls` with the person as
  `x-strut-actor` (a call), and for the Packages page `GET /packages`,
  `GET /packages/search`, `GET/PUT/DELETE /packages/indexes[/:id]`,
  `POST /packages/install` and `DELETE /packages/:publisher/:name` with
  the admin as `x-strut-actor`, `GET /packages/installs[/:id]`,
  `GET /secrets` (names) and `PUT /secrets/:name`.
- **Sign-in comes back.** A signed-out visitor is sent to
  `/signin?next=<the page, query and all>` and lands there after signing
  in. The middleware (`ui/src/middleware.ts`) hands each page its own
  address in `x-stadeum-path`, set by it whatever the request carried;
  `next` is kept only as a path on this site, never sign-in or the API
  (`ui/src/lib/next-path.ts`).
- **Sign-in through a bounce** (`STADEUM_SIGNIN_BOUNCE`,
  `ui/src/lib/signin-bounce.ts`). Google takes no wildcard in a redirect
  URL and has no API to add one, so boxes under one domain can't each
  register their own. With the setting (e.g. `https://auth.example.com`)
  they share the bounce's. Google and Microsoft are registered once, with
  `<bounce>/api/auth/callback/google` and
  `<bounce>/api/auth/callback/microsoft-entra-id`, for every box.
  - Auth.js sends the provider to the bounce on both legs
    (`redirectProxyUrl`): the authorization, and the code exchange that
    must repeat its `redirect_uri`.
  - The box puts its label, its host's first name (`acme` for
    `acme.example.com`), in front of the OAuth `state`: `acme.<state>`.
  - The bounce reads the label and redirects to
    `https://<label>.<its domain>`, with the path and query unchanged. It
    holds no secret, checks nothing else and stores nothing. A Caddy site
    does it:

    ```
    auth.example.com {
    	@box vars_regexp box {query.state} ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\.
    	redir @box https://{re.box.1}.example.com{uri} 302
    	respond 400
    }
    ```

  - The box takes its label off when the callback comes back, before
    Auth.js checks the state against its own cookie.
  - Every box behind one bounce holds the same client secrets. The state
    cookie and PKCE still bind each code to the browser that started the
    sign-in, so one box can't sign in to another. Run a bounce only for
    boxes whose `.env` you alone hold, and name no box like the bounce.
  - Not Auth.js's own redirect proxy (`AUTH_REDIRECT_PROXY_URL`): its
    proxy decrypts the state, so every box would share one `AUTH_SECRET`,
    and any box could forge another's sessions.
- **The frame.** Per page load the server mints a sign-in ticket for the
  person (`POST /auth/ticket { actor, role }` → `{ ticket, expiresAt }`, good
  once for 60 s; `role` is the person's stadeum role, `admin` or `member`:
  strut gives an admin the operator console and a member their apps alone,
  strut `plans/member-rights.md`) and frames
  `{STRUT_PUBLIC_URL}/?ticket=<ticket>&embed_origin=<stadeum origin>[&wf=&run=]`.
  strut's UI trades the ticket for its own session cookie as that person and
  takes it off the URL (strut `specs/API.md` §13.1).
- **Packages** (admins; `ui/src/app/(app)/packages/`, strut `specs/API.md`
  §16). Installed: each package, its version, apps, workflows, steps and
  Concepts (an item edited here is marked), and the secrets its steps read
  that strut's store has no value for (`GET /secrets` names against the
  package's `secrets`), each with a write-only field that `PUT`s it to
  strut's deployment store. Only a name an installed package declares is
  set there, never `STRUT_DEFAULT_MODEL` or `STRUT_MODELS`. Uninstall asks
  first and says what strut kept. Find: `GET /packages/search` over the
  indexes strut follows (peers' installs are left out: a hit is installed
  by its name through an index), each hit with what the index read off the
  release: what it brings, whether it spends model calls, acts on the
  world or runs code, and its secrets. Install asks first with the same
  facts, then `POST /packages/install { ref: <name>, index, digest, wait:
  false }`: the release reviewed, through the index that listed it, as
  the admin. Strut answers at once with the install's record (stakwork/
  strut#588; an older strut answers when it is done), and the dialog
  reads `GET /packages/installs/:id` every 600 ms, not while the tab is
  hidden, showing the phase and how far ("Concepts 312 / 752", a bar)
  until it ends. Closing the dialog leaves the install going, shown under
  Installing; so is any install strut was running when the page loaded
  (`GET /packages/installs`: another admin's, a proposal someone
  accepted, the boot list, the distro), until dismissed.
  Strut's refusals are said plainly, strut's own words after
  (`package_update_not_built`: uninstall first; `package_busy`,
  `package_conflict`, `package_distro_owned`, `catalog_*`). Indexes: the
  ones strut follows, a form to follow one by its key and card address
  (filed under its host, as strut's own UI does), and Remove.
- **The store's Install link.** The store (`https://index.stakwork.ai/?store=1`)
  opens `<the address a visitor saved>/?install=<publisher/name>&index=<z-base-32 key>&index_url=<its card>`,
  keeping the saved path: an admin who saves `https://<HOST>/packages`
  lands on this page (Next drops the trailing slash and keeps the query;
  signed out, they come back to it after sign-in). The page reads it as
  strut's shell does (`parseInstallLink`: a package name; the index only
  with a 52-character z-base-32 key and an http(s) address). When strut
  follows no index with that key, the page shows the key and offers
  Follow this index (`PUT /packages/indexes/<its host> { key, urls:
  [index_url], label }`); then, or at once when it does, it opens the
  package's confirmation. Nothing installs on load: Install is always the
  admin's click. A link never replaces another key filed under the same
  host: the admin removes that index first.
- **Calls.** The one live thing stadeum draws: a strut app's frame cannot
  carry media. The `(app)` layout holds the call (`ui/src/components/call.tsx`),
  so it goes on while the person moves between pages, the framed apps among
  them; the rail shows it and hangs it up. Talk makes the call's key in the
  browser and posts it to `POST /api/calls`, which checks the person's
  session and that the request came from stadeum's own origin (strut's
  subdomain is the same site, so the cookie alone would not do), and hands
  it to strut. The answer passes through, `no-store`; 400, 402 and 503 are
  strut's, said plainly on the page. The browser refuses an answer without
  `encrypted: true`, a LiveKit server that is not `wss://` (or `ws://` on
  this machine) and a token for another room (`ui/src/lib/calls.ts`), then
  joins with livekit-client's E2EE worker (`ui/src/lib/call-room.ts`, loaded
  only on a call). Nothing logs, keeps or puts in a URL the key, the room
  or the tokens. The page knows a call, never a conversation, a run or a
  job.
- **What a call shows** (`ui/src/lib/call-transcript.ts`). Both sides' words
  as LiveKit Agents publish them on `lk.transcription`, folded one line per
  speaker and `lk.segment_id` (the agent's reply word by word in time with
  its audio; the person's words replaced as the recogniser revises them);
  whose they are is `lk.transcribed_track_id`, the agent's own track or the
  person's. With `artifacts: true` on the call, sphinx-voice sends the
  artifacts strut's turn ended with on `sphinx.artifacts`, strut's
  `ArtifactRef`s untouched, and its agent may say "on your screen". Each
  becomes a card under the reply it came with. A text stream is read only
  from the agent's identity and only when it came encrypted (GCM). A card
  opens through strut: a file in strut's artifact viewer alone
  (`?artifact=<served path>&solo=1`, a peer's through `/peers/<id>`), an
  app by its key (`?app=<name>[@vN]&solo=1`), each framed beside the call
  with a one-use ticket minted by a server action (which checks the path or
  key again); an `https` link in a new tab; anything else is shown, not
  linked. The words and the cards are in memory only: they stay after the
  call to read and open, until the next one.
- **The page** has no header: the waveform in its orb (bars that breathe,
  follow the assistant's voice or the person's microphone, roll while it
  thinks, lie flat when muted; still under reduced motion), and Talk. As
  the call starts the orb rises, the transcript flows in under it, and Mute
  (`M`) and End settle at the bottom; a card's viewer sits beside the
  transcript, or over it on a phone (`Esc` closes it).

### ops
- `ghcr.io/stakwork/stadeum-ops:${STADEUM_IMAGE_TAG:-stable}`, built from
  `ops/` with the repository's root as its context: Node running the loop,
  the docker CLI with its compose plugin, and restic, each from a pinned
  image. No runtime npm dependencies. It also carries its commit's release
  at `/usr/local/share/stadeum`: `stack/` (without `local.yml` and
  `dev.yml`), `.env.example` and `scripts/init-env.sh`
  (`ops/Dockerfile.dockerignore`).
- **No port.** It starts every connection itself: stadeum-ui
  (`STADEUM_UI_URL`) for its settings and to post back, strut (`STRUT_URL`)
  for the drain and the health check, both with `SHARED_API_TOKEN` as
  Bearer. Healthcheck: a heartbeat file its loop writes every 15 s.
- **The Docker socket**, mounted here and nowhere else. ops drives the
  containers with `docker compose`, run against the files and env file the
  stack was started with: compose's own labels on ops's container
  (`com.docker.compose.project`, `…config_files`, `…environment_file`,
  `…working_dir`) say which, and the box's `stack/local.yml` is added last
  when it is there. The box's directory (`/opt/stadeum`; on a laptop, the
  checkout) is mounted at `/stadeum`, and ops links its host path to it, so
  compose resolves `./caddy/Caddyfile` to the host path the daemon needs. Why compose and not the Docker API: compose
  already knows how to recreate a container with its networks, volumes,
  labels and healthcheck, so an update is the `compose pull` + `compose up`
  a person would type, and ops reimplements none of it.
- **Every volume but `strut-models`** is mounted at `/volumes/<name>`, for
  the snapshot and the restore (strut fetches its models again; a restore
  leaves a volume the snapshot lacks as it is), and the box's `backups/` at
  `/backups` (a local destination).
- **Three labels** in `stack/stadeum.yml` say what ops does to a service:
  `stadeum.ops.update: <group>` (strut, strut-browser, voice and treasury in `strut`;
  stadeum-ui + ops in `stadeum`, ops's own group: the release),
  `stadeum.ops.backup: stop` (neo4j, redis, bifrost, strut, treasury, stadeum-ui) and
  `stadeum.ops.upgrade: confirm` (neo4j). A service with `restart: "no"`
  (bootstrap) is a one-shot: an update never starts it.

**Its settings** live in stadeum-ui's database (`OpsSettings`), set on the
admin pages Updates and Backups: the daily window (start, end, IANA time
zone; default 03:00–05:00 UTC), how long to wait for strut to go idle
(default 30 min), whether updates and backups run on their own, and the
backup destination. The destination's credentials and restic's password are
encrypted under `STADEUM_ENCRYPTION_KEY`, as the org key is.

**The contract** (`ops/src/contract.ts`, copied in
`ui/src/lib/ops/contract.ts`), every call by ops, with the deployment key:

| Method | Path | |
| --- | --- | --- |
| GET | `/api/ops/settings` | The window, the wait, updates on or off, the destination (decrypted), the admin's open requests (check, update, back up now, and `confirm` with the image references an admin agreed to), the window last run, and the images that failed their health check |
| PUT | `/api/ops/status` | What ops is doing, every service's running image (with the digests it was pulled as) and, for one on a channel, what its registry said the tag names (`latest`: when, the digest, whether it runs, a newer one's commit and build time, or why the check failed), the release that runs and what the channel's would change (files, pins, what holds it), the newest snapshots, and the requests it answered |
| POST | `/api/ops/history` | What it did: an update (with each image's from and to), a rollback, a backup (its snapshot), a restore |

Caddy answers `/api/ops/*` with 404: the routes are for the box's network
only.

**The loop** ticks every 30 s. It reads its settings, does what an admin
asked for, and once in each day's window runs the daily pass: the backup,
then the updates, held back if tonight's backup failed: strut's group, then
stadeum's release. stadeum-ui keeps the window last run, so a restarted ops
does not run it twice. While a release is being applied (the one-off below
runs), the loop keeps still.

**What the channels name** (`ops/src/registry.ts`, `lookUp` in
`ops/src/update.ts`): every 10 minutes, on Check now, and after an update,
ops asks each channel's registry what its tag names, pulling nothing. It
follows the registry's own token challenge anonymously, and `HEAD`s
`/v2/<repository>/manifests/<tag>` accepting a multi-arch index, which
answers with the index's digest: the one `docker pull` records in the
image's RepoDigests (and, on Docker's containerd store, its ID). An image is
current when what runs was pulled as that digest. A newer one's commit and
build time come from its manifest for this box's platform, two small GETs,
once per image. Only the four images on a channel are asked about (strut,
strut-browser, stadeum-ui, stadeum-ops, all on ghcr.io): about 1,150 small
requests a day. The pinned images (Neo4j, Caddy, Redis, the gateway) move
with a release and the page claims nothing of them; a `HEAD` would not count
against Docker Hub's anonymous pull limit anyway (a manifest `GET` does).
When stadeum-ops's tag names another release, ops pulls that release's two
small images once (about 260 MB) to say what it would change, a held Neo4j
among it; strut's images move only in the window or on Update now.

The Updates page says an image is current only from that answer, and when
it was given (`ui/src/lib/ops/channel.ts`): "Current · checked 4 minutes
ago"; "c15177a is out, built 2 hours ago"; "Not checked yet"; "Current when
checked 3 hours ago" once the answer is more than 30 minutes old; or "Could
not check" with why, and what the last answer was.

**Check now and Update now** each file a request, one open of a kind: a
second click shows the open one, never another. The page follows it from
what stadeum-ui already has (`ui/src/lib/ops/progress.ts`), re-reading
`GET /api/updates` every 3 s while it is open: waiting until ops takes it
up (or why not: ops busy, or not answering); then each phase ops reports,
with the time it began; then what ops recorded since it was asked (updated,
from and to which commit or release; rolled back or failed, and why), or
nothing to update with what the check found. A check ends with what the
registries said, and when. ops marks an update done before it hands a
release over, and says so (updating) until the ops it brings has recorded
the release's outcome and gone idle, so the page follows the release too,
across stadeum-ui's own restart.

**An update** of a group that follows a channel (strut's):

1. `compose pull` the group, and compare the image ID each tag now names
   with the one its container runs.
2. If any differ: a group with strut in it turns on strut's drain
   (`PUT /drain {reason, minutes}`, strut `specs/API.md` §8.1) and polls
   `GET /drain` until `idle`, at most the wait. Runs still going then resume
   after the restart (strut auto-resumes). `minutes` is the wait plus 30, so
   a drain whose ops died lifts by itself.
3. `compose up -d --no-deps --wait`: recreate what changed and wait for the
   containers' healthchecks; then strut's `GET /health` with the key.
4. Unhealthy: tag the images it replaced back onto the reference and
   `compose up` again. The bad image is held back (not tried again) until
   the channel moves on or an admin presses Update now.
5. Record what changed, and lift the drain if a restart did not.

**A release** is stadeum's channel: stadeum-ops's image, stadeum-ui's, and
the stack files ops's image carries (`ops/src/release.ts`). The files pin
every other image, so a release moves Caddy, Redis and the gateway too.

1. When the registry names another stadeum-ops (above), or an update
   runs, ops pulls stadeum-ui and ops. If either moved, ops reads the new
   release's files out of the new ops image (`docker create` + `docker
   cp`), stages them, and has compose read them with the box's `.env` and
   `local.yml`, which proves they parse. It reports what they change: the
   files, and each service whose pin moves. It puts the release's tags back
   on what runs, so a person's `compose up` cannot bring half a release in.
2. A release that changes the image of a service labelled
   `stadeum.ops.upgrade: confirm` (Neo4j) is **held**: nothing of it moves,
   files or images. The Updates page says a release is waiting and what it
   upgrades, from what to what, which cannot be undone, with an **Upgrade
   Neo4j** button. The button files a `confirm` request naming the
   references the admin saw. ops then takes a fresh backup (the nightly
   one's restic snapshot), and only if it succeeded hands the release over
   with those references; a release that has moved on since is held again.
3. Otherwise ops hands the release to the ops it brings: it tags the
   release's images and starts a one-off ops on the new image (`compose
   run -d --rm ops hand-over <previous ops image> [--confirm <refs>]`). The
   new ops applies its own files, because they are its: the code that
   knows a release is the release's own, and it may change how a release
   goes in without waiting a release. And `compose up` must run outside the
   ops service's container, since it may recreate ops itself. The old ops
   waits; if the new code dies, it is still there.
4. The one-off plans again (and holds again, unless told the admin
   confirmed), pulls what the files pin and the box lacks, and works out
   what compose will recreate: a service whose config hash (`compose config
   --hash`, the `com.docker.compose.config-hash` it was made with) or image
   differs, a new one, or one that bind-mounts a file that changes (a new
   Caddyfile needs a new Caddy). It drains strut unless only stadeum-ui and
   ops move, writes the files that change (each renamed over the old) and
   removes those the release dropped, then `compose up -d --no-deps
   --force-recreate --remove-orphans --wait` those services, ops among
   them, and checks strut's health with the key if strut moved.
5. Unhealthy: the previous ops image's stack files go back (or, from an ops
   older than releases, the box's own copies), every image's tag goes back
   on what ran, and `compose up` again. The release's images are held back
   (not tried again) until the channel moves on or an admin presses Update
   now.

The release never writes `.env` or `stack/local.yml`, and an ops built here
(`stack/dev.yml`) has no releases: the files are the checkout's.
`scripts/release-e2e.sh` proves it on a box of its own, with a registry
standing in for ghcr.io: a release that changes a Caddy route, a setting
and a pin goes in; a broken one comes back off; one that moves Neo4j waits
for Upgrade Neo4j, which backs up first.

**Old images.** strut and strut-browser are 3.5 GB or more each, and every
update leaves the image it replaced behind, so ops removes what it no
longer needs: at the end of each update pass, and of each release's apply,
whether it went in or rolled back (`ops/src/images.ts`). With Docker's
containerd image store an image whose tag moved keeps no name at all, and
labels do not tell strut's images from strut-browser's, so ops keeps a name
on each image it wants:

- the service's reference names what runs;
- `<repository>:ops-previous` names what ran before it, kept for a rollback
  by hand (`docker tag …:ops-previous …:stable`, then `compose up`);
- `<repository>:ops-channel` names what the channel had at the last check:
  a release not applied yet, or one held back. A held-back image stays while
  the channel names it, so the nightly check finds it without downloading
  it again, and goes once the channel moves on.

An image goes only if ops moved one of those names off it, no container on
the machine uses it (any project, running or stopped), and it has no name
ops does not own. A release that moves a pin moves the old pin's name to
`ops-previous` too, unless another project on the machine runs that image.
Images ops never named are never touched. The update's history line says
what went and the space it freed (each removed image's own layers, from
`docker system df -v`).

**The box needs no git checkout.** `scripts/install.sh` writes the stack
files from stadeum-ops's image: on a fresh box the stable channel's, after
that the release the box's ops runs, so running it again writes back what
ops last put in place instead of fighting it. A checkout would be a second
source of the same files, one that `git pull` and ops would both write.

**A backup**, in the window, or when an admin presses Back up now:

1. Open the restic repository, making it on first use.
2. Drain strut and wait, as above.
3. `compose stop` the services labelled `stadeum.ops.backup: stop` (Neo4j
   community has no online dump; SQLite and redis tear mid-write), copy the
   env file to `/env/.env`, `restic backup /volumes /env`, and start them
   again whatever happened. A few minutes of downtime.
4. `restic forget --prune`: 7 daily, 4 weekly, 12 monthly.

Destinations are restic's: S3 and S3-compatible (R2, MinIO), Azure Blob,
GCS, B2, and a folder under `/backups` for testing. stadeum-ui turns the
admin's fields into restic's repository string and its own variables
(`ui/src/lib/ops/destination.ts`). restic's password is made with the first
destination and never changes; the Backups page shows it, with a restore
kit, until the admin says they keep it off the box, and never again.

**A restore** is the install on a new box, with the restore kit (saved as
`/root/restore.env`): it puts the release's files in place, restores the
snapshot, then starts the stack.

```bash
curl -fsSL https://raw.githubusercontent.com/stakwork/stadeum/main/scripts/install.sh | sudo STADEUM_RESTORE=/root/restore.env bash
```

From a checkout, it is these. `ops restore <id>` (for the install,
`STADEUM_SNAPSHOT=<id>`) restores another snapshot than the latest.

```bash
scripts/init-env.sh
docker compose --env-file .env -f stack/stadeum.yml run --rm --env-from-file restore.env ops restore [snapshot]
docker compose --env-file .env -f stack/stadeum.yml up -d --wait
```

It stops the stack, empties each volume the snapshot has, restores them,
and puts the snapshot's `.env` back (keeping the one it replaced as
`.env.before-restore`). That `.env` names the old box's `HOST`: for another
name, pass `STADEUM_HOST` to the install, or change it before `up`. `scripts/backup-restore-e2e.sh` proves it: data in
strut, stadeum-ui and Neo4j, a backup, every volume wiped and `.env`
regenerated, a restore, and the same data back.

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

- **Calls.** One LiveKit key per box, minted as the box is provisioned, once
  the LiveKit server has a way to add keys without a restart. sphinx-voice's
  voice turns on strut's default model when `VOICE_MODEL` is unset.

- The node `created_by` property: `graph/create-node` passes `ctx.actor`, but
  a verify run's node came back with `created_by = NULL` although the run's
  actor was set (seen under repo2graph). Check before relying on it.
