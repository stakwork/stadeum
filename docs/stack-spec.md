# Stack spec (extracted from sphinx-swarm `dd0f132d`)

Source of truth for `stack/stadeum.yml`. All `file:line` refs are in
[stakwork/sphinx-swarm](https://github.com/stakwork/sphinx-swarm). Extracted by reading the Rust image modules; verify
anything marked "open" before relying on it.

## v1 containers

`docker compose -f stack/stadeum.yml [-f stack/dev.yml] up` starts exactly
these; there are no profiles. The Status page in stadeum-ui lists the same
seven (`ui/src/lib/status.ts`, `SERVICES`).

| Service | Image | Role | Status page check |
| --- | --- | --- | --- |
| `load_balancer` | `traefik:v2.11.31` | Only public ports (80/443); routes `$HOST`, `bifrost.$HOST`, `repo2graph.$HOST` | None (stadeum-ui never calls it) |
| `neo4j` | `neo4j:5.19.0` | Knowledge graph, Strut workflow store | `GET {NEO4J_HTTP_URL}/` |
| `redis` | `redis:7.4.2-alpine` | bifrost plugin state, mcp | None (stadeum-ui never calls it) |
| `bifrost` | `stakgraph-gateway` | Model gateway, mothership trust/budgets | `/_plugin/trust/status` |
| `repo2graph` | `stakgraph-mcp` | mcp + Strut lab | `GET {MCP_URL}/lab/llm/mothership` |
| `bootstrap` | `node:22.20.0-alpine` | One-shot: org signing key + trust registration | Org key registered with bifrost, same key as stadeum-ui's |
| `stadeum-ui` | built from `ui/` | Sign-in, Home, Members, Status | Running (it serves the page) |

stadeum-ui has no Docker socket, so it cannot see container state; each
row's health is the HTTP check it already makes, and traefik and redis show
"Not checked".

**Removed in the v1 cleanup** (each confirmed unused by grepping this repo
and stakgraph `origin/main` `643e12fd` `mcp/src`):

- Volume `repo2graph-tests` (`/usr/src/app/tests/generated_tests`): only
  mcp's eval test runner reads it (`TESTS_DIR`), which v1 does not use.
- Volume `repo2graph-cache` and env `STRUT_CACHE_DIR`, `VEIN_CACHE_DIR`,
  `HF_TOKEN`: only the GAIA benchmark bootstrap reads them
  (`mcp src/lab/gaia/bootstrap.ts`); `VEIN_*` is read nowhere.
- Env `VEIN_LAB_WORKSPACE`: read nowhere (`STRUT_LAB_WORKSPACE` stays).
- `extra_hosts: host.docker.internal:host-gateway` on every service:
  nothing in the stack calls the host.
- The `ui` profile: stadeum-ui is part of v1, so it starts by default.

Kept: `repo2graph-reqs` (mcp's async request store, `src/graph/reqs.ts`,
read back after a restart), `repo2graph-sessions`, `repo2graph-artifacts`,
`repo2graph-lab-workspace`, and the public `bifrost.$HOST` and
`repo2graph.$HOST` routes (operator access to the gateway admin API and the
Strut lab; `repo2graph.$HOST` is also stadeum-ui's `MCP_PUBLIC_URL`, where
the browser loads a hosted Strut app from).

## Shared conventions

- Hostname `<name>.sphinx` (`src/utils.rs:276-281`); network `sphinx-swarm` (`src/dock.rs:777`). Stadeum: compose key `sphinx-swarm`, docker name `stadeum_sphinx-swarm` (so it never collides with a real swarm's network on the same host), and each service gets a `<name>.sphinx` network alias, which is what DNS resolves.
- `restart: unless-stopped` (`src/utils.rs:18-53,262`). Swarm also adds `extra_hosts: host.docker.internal:host-gateway`; stadeum drops it (nothing calls the host).
- Named volume `<name>.sphinx` at the image's root volume (`src/utils.rs:360-367`).
- Swarm publishes every container port on the host. **Stadeum does not**: only traefik's 80/443 are public; everything else stays on the network.
- Traefik labels per `traefik_labels()` (`src/images/traefik.rs:123-175`): enable, server.port, tls, certresolver=myresolver, entrypoints=websecure, `Host(...)`.

## Services

### traefik (`load_balancer`)
- `traefik:v2.11.31` (`second-brain-2.yml`). The Rust `_traefik()` is dead code; the real config is in `second-brain.yml:6-41`.
- Commands: docker provider (exposedbydefault=false), entrypoints web :80 → redirect to websecure :443, ACME tlschallenge resolver `myresolver`, storage `/letsencrypt/acme.json`. ACME email must be configurable (repo hardcodes a personal address).
- Mounts docker socket + `./letsencrypt`.

### neo4j
- `neo4j:5.19.0` (`neo4j.rs:170-178`, `secondbrain.rs:61`). Private: no traefik labels (`neo4j.rs:263-272`).
- Volume `/data`. Env (`neo4j.rs:224-259`): `NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}`, apoc export/import/uuid enabled, heap 6g/6g, pagecache 8g, tx total 4g / tx 1g, checkpoint iops 500, listen 0.0.0.0, bolt 0.0.0.0:7687, procedures allowlist/unrestricted `apoc.*,gds.*,algo.*`, allow_upgrade, default db `neo4j`, min password length 4, `NEO4J_PLUGINS=["graph-data-science"]`. Memory sizes should be env-overridable for laptops.
- **Plugins:** swarm copies into the running container (`neo4j.rs:65-134`): `apoc-5.19.0-extended.jar`, `apoc-5.19.0-core.jar` (with bundled commons-lang3 stripped, `neo4j.rs:95-100,139-161`), `neo4j-graph-data-science-2.9.0.jar`, and `conf/apoc.conf` (`APOC_CONF`, `neo4j.rs:276-294`, fulltext/vector index initializers).
- **Stadeum (phase 1, verified):**
  - `scripts/fetch-neo4j-plugins.sh` downloads the three jars into `stack/neo4j/plugins` (git-ignored), bind-mounted read-only at `/plugins` (the entrypoint uses `/plugins` when it exists).
  - GDS: swarm saves the release **zip** under a `.jar` name (`neo4j.rs:122-131`), so the GDS it actually runs comes from `NEO4J_PLUGINS`. Stadeum unzips the real 2.9.0 jar and **drops `NEO4J_PLUGINS`**: it would download a second GDS into `/plugins` at every boot. GDS 2.9.0 reports "for Neo4j 5.19 -- available".
  - apoc.conf: the neo4j entrypoint writes every `NEO4J_apoc_*` env var into `conf/apoc.conf` with `sed -i` + append, so a bind-mounted file either fails (`:ro`, "Device or resource busy") or is rewritten on the host at each boot. The `APOC_CONF` lines are therefore `NEO4J_apoc_*` env vars in `stadeum.yml` (`_` → `.`, `__` → `_`), and the entrypoint generates the file. All 14 initializers run (16 indexes after first boot).
  - Memory: `NEO4J_HEAP_INITIAL/HEAP_MAX/PAGECACHE/TX_TOTAL_MAX/TX_MAX/CHECKPOINT_IOPS`, defaults 1g/1g/1g/1g/512m/500.

### redis
- `redis:latest` (stadeum pins `redis:7.4.2-alpine`), `redis-server --appendonly yes` (`redis.rs:73-77`), volume `/data`, private.

### bifrost (mothership / LLM gateway)
- `ghcr.io/stakwork/stakgraph-gateway:latest` (`bifrost.rs:113-126`, GHCR only). Port 8181 (wrapper; proxies to bifrost-http on 127.0.0.1:8080). Do NOT set APP_PORT/APP_HOST (`bifrost.rs:140-146`).
- Volume `/app/data` (only one mount there, `bifrost.rs:245-248`). Traefik host `bifrost.${HOST}`.
- Env: `BIFROST_ADMIN_USER=admin`, `BIFROST_ADMIN_PASS` (random 16; bcrypted on first boot into /app/data), `BIFROST_PROVISIONING_TOKEN=${SHARED_API_TOKEN}`, `BIFROST_PLUGIN_REDIS_URL=redis://redis.sphinx:6379/0`, `NEO4J_HTTP_URL=http://neo4j.sphinx:7474`, `NEO4J_PASSWORD`, provider keys OPENAI/ANTHROPIC/OPENROUTER/GOOGLE/XAI (only if non-empty). Optional `BIFROST_PLUGIN_ENFORCE_MACAROONS`, `BIFROST_PLUGIN_ENFORCE_BUDGETS` (default: baked config.json, shadow mode). Stadeum phase 2 sets both to `true`.

### repo2graph (Strut + mcp + stakgraph)
- `ghcr.io/stakwork/stakgraph-mcp:latest` (`repo2graph.rs:84-93`), port 3355, traefik host `repo2graph.${HOST}`. Requires neo4j (`repo2graph.rs:72`).
- Volumes (`repo2graph.rs:215-236`): `/root`, `/usr/src/app/{tests/generated_tests,sessions,artifacts,reqs,cache,lab-workspace}`. Stadeum keeps `/root`, `sessions`, `artifacts`, `reqs`, `lab-workspace` (see "v1 containers").
- Env (`repo2graph.rs:111-213`): `PORT=3355`, `NEO4J_HOST=neo4j.sphinx:7687`, `NEO4J_PASSWORD`, `SAGE_CONFIG_PATH=/root/sage_config.json`, `USE_STAGEHAND=1`, `PAT=${GITHUB_REQUEST_TOKEN}`, `API_TOKEN=${SHARED_API_TOKEN}`, `REDIS_URL=redis://redis.sphinx:6379`, provider keys OPENAI/ANTHROPIC/OPENROUTER/XAI/EXA, `STRUT_CHAT_MODEL`, `STRUT_LLM_MODEL`, `HF_TOKEN`, `SESSIONS_DIR`, `AGENT_ARTIFACTS_DIR`, `REQS_DIR`, `VEIN_CACHE_DIR`+`STRUT_CACHE_DIR=/usr/src/app/cache`, `VEIN_LAB_WORKSPACE`+`STRUT_LAB_WORKSPACE=/usr/src/app/lab-workspace`, optional `STRUT_MOTHERSHIP_REQUIRED`, optional `LLM_PROVIDER` (default openai).
- Dropped: `JARVIS_URL`, `HERMES_URL`, `BROWSER_WS_URL`/`BROWSER_WS_PATH` and the second network; in v1 also `HF_TOKEN`, `VEIN_CACHE_DIR`, `STRUT_CACHE_DIR`, `VEIN_LAB_WORKSPACE`.
- **Image bug (2026-11-04):** the `linux/arm64` variant of `stakgraph-mcp:latest` (created 2026-11-03) crash-loops: `Cannot find module '@anush008/tokenizers-linux-arm64-gnu'` (only `tokenizers-linux-x64-gnu` is in `node_modules`). `stadeum.yml` pins `platform: ${REPO2GRAPH_PLATFORM:-linux/amd64}`; arm64 hosts run it emulated. Fix belongs in stakgraph's image build.
- **The lab needs the `LLM_PROVIDER` key to boot.** `buildConceptServices` calls `getApiKeyForProvider` when the lab strut is first built (mcp `src/lab/concepts/services.ts:151`), so with the key blank every `/lab/*` request returns 500 `API key not found for provider: <provider>`, even for workflows that make no LLM call. `/health` stays 200.
- Stadeum sets `LLM_PROVIDER=anthropic` by default (swarm: unset → openai).

## The shared token (replaces boltwall)

`SHARED_API_TOKEN` was boltwall's `stakwork_secret` (`boltwall.rs:27-28,175-187`): an opaque random string, copied by Rust into bifrost (`BIFROST_PROVISIONING_TOKEN`, Bearer for `/_plugin/admin-credentials`) and repo2graph (`API_TOKEN`). Nothing fetches it from boltwall at runtime, so a generated `openssl rand -hex 16` replaces it.

## Strut inside repo2graph (answered from source)

Read from stakgraph `origin/main` `643e12fd` (`mcp/`, which pins strut
`dbbc62e6`) and strut `dbbc62e6`. The [stakwork/stakgraph](https://github.com/stakwork/stakgraph) checkout
was 37 commits behind; refs are to `origin/main`. Every answer below was also
checked against the running image.

1. **How Strut finds bifrost: no env var, no default.** The lab strut always
   mounts the Mothership module (`mcp src/lab/createLabStrut.ts:272,319`,
   `createMothership({ dataDir: workspacePath })`); the gateway URL is the
   `baseUrl` of each actor's delegation, pushed with
   `PUT /lab/llm/delegations/:actor {macaroon, apiKey, baseUrl}` (strut
   `src/mothership.ts:368-380`; must match `^https?://`). With no delegation
   on file, steps call the providers directly with the provider keys. Stadeum
   pushes `baseUrl: http://bifrost.sphinx:8181` in phase 2.
   Separately, mcp's own non-Strut LLM calls (aieo) read `LLM_GATEWAY_URL`
   (`mcp src/aieo/src/provider.ts:20`; unset = direct). Stadeum leaves it unset.
2. **Port and paths.** One Express server on `PORT` (default 3355,
   `mcp src/index.ts:377`). Strut's API and its web UI are both mounted at
   `/lab` (`src/lab/mount.ts:310-321`): `/lab` → 308 → `/lab/` serves the UI,
   `/lab/workflows`, `/lab/llm/mothership`, … are the Strut API. `/health` is
   public. There is no separate Strut port.
3. **How mcp sets the embedded Strut's env.**
   - `STRUT_API_KEY`: **not set, and must not be.** mcp gates `/lab/*` itself
     with `API_TOKEN` (`src/lab/mount.ts:162-191`); the lab strut "has no key
     of its own" (`src/lab/proxy.ts:199-206`). Setting `STRUT_API_KEY` would
     add strut's own Bearer gate behind mcp's and reject mcp's credentials.
     Accepted at `/lab`: `x-api-token: API_TOKEN` (+ optional `x-strut-actor`),
     a `/mint-token` JWT as `Authorization: Bearer` or `?key=`, a `lab:peer`
     JWT (Bearer only), or Basic `admin:API_TOKEN`. `API_TOKEN` unset = open.
   - `STRUT_MOTHERSHIP`: **not used by mcp.** It only gates the standalone
     strut server (strut `src/server.ts:126-134`). Inside mcp the module is
     always mounted (`GET /lab/llm/mothership` → `{"enabled":true}`).
   - `STRUT_SECRET_KEY`: derived from `API_TOKEN` when unset
     (`mcp src/index.ts:92-94`), so `SHARED_API_TOKEN` encrypts `secrets.json`
     and `mothership.json`. Rotating it makes both unreadable (mothership
     self-heals on re-push; secrets must be re-entered).
   - `STRUT_WORKSPACE`: **not used.** The lab's data dir is
     `STRUT_LAB_WORKSPACE` (default `./lab-workspace`,
     `src/lab/createLabStrut.ts:159-162`), passed explicitly as `dataDir`.
     Workflows/steps live in Neo4j by default (`STRUT_WORKSPACE_BACKEND=fs`
     for disk); runs, chats, secrets and `mothership.json` stay on disk there.
   - The lab scrubs `process.env` on first boot (`src/lab/mount.ts:82-92`);
     `STRUT_ENV_SCRUB=0` / `STRUT_ENV_KEEP=A,B` control it.
4. **`/mint-token`** (`mcp src/index.ts:203`, `src/repo/events.ts:118-143`).
   `POST /mint-token`, header `x-api-token: API_TOKEN` only (a JWT cannot mint;
   503 when `API_TOKEN` is unset). Body
   `{expires_in?: string (default "1h"; "60d" for lab:peer), sub?: string, scope?: "api" | "lab:peer"}`
   → `{token, expires_in, scope, sub?}`. HS256 JWT signed with `API_TOKEN`,
   payload `{scope, sub?}`. At `/lab`, `labAuthorized` verifies it and grants
   `actor = sub` (`src/lab/mount.ts:168-181`), stashed on the request and read
   by strut's `resolveActor: resolveLabActor` (`src/lab/createLabStrut.ts:283`).
   Verified: a run launched with a JWT minted for `sub: "alice@acme"` records
   `"actor": "alice@acme"`.
5. **`STRUT_MOTHERSHIP_REQUIRED` default: off.** mcp sets nothing; strut reads
   `=== "1"` (`strut src/auth.ts:605-607`), so unset or `0` = off. Swarm only
   sets it when the image struct says so (`repo2graph.rs:205-213`). Stadeum
   sets `0` explicitly; phase 2 turns it on.
   **Phase 2:** fixed at `1` in `stack/stadeum.yml`.
6. `LLM_PROVIDER`: stadeum defaults to `anthropic`. Its key must be set for
   the lab to boot (see repo2graph above). **Phase 2:** repo2graph gets a
   non-secret placeholder for it plus `LLM_GATEWAY_URL=http://bifrost.sphinx:8181`;
   real keys live only in bifrost.

## Still open

- ~~Whether bifrost accepts a macaroon without `realm_id` / the agent catalog
  being set~~: answered in `docs/mothership-spec.md` ("Answers (phase 2)").
- The node `created_by` property: `graph/create-node` passes `ctx.actor`, but
  the verify run's node came back with `created_by = NULL` although the run's
  actor was set. Not needed for phase 1; check before relying on it.
