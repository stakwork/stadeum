# Mothership contract: what stadeum-ui does instead of Hive

How a signed-in person gets to run LLM steps on Strut. Extracted from Hive
([stakwork/hive](https://github.com/stakwork/hive)), Strut ([stakwork/strut](https://github.com/stakwork/strut)) and gatekey. Refs are
`file:line` in those repos.

## Topology and secrets

- Bifrost gateway root: `http(s)://<host>:8181` (Hive `src/services/bifrost/resolve.ts:39-54`). In stadeum: `http://bifrost:8181` on the network.
- Strut: its own image, `http://strut:3000` on the network (stadeum-ui's `STRUT_URL`). Hive reaches it inside mcp at `<repo2graph>:3355/lab` instead (Hive `src/lib/utils/swarm.ts:22-30`, `strut-delegation.ts:137`).
- ONE shared secret (`SHARED_API_TOKEN` in stadeum) is used as: bifrost provisioning token (Bearer on `/_plugin/*`) and Strut `STRUT_API_KEY` (Bearer). Hive also sends it as mcp's `x-api-token` (`strut-delegation.ts:161-167`).

## Steps per (gateway, user)

### a. Bifrost admin credentials
`GET {gw}/_plugin/admin-credentials`, Bearer provisioning token → `{admin_username, admin_password}` (Hive `bifrost/bootstrap.ts:56-188`). Store encrypted. All `/api/*` calls then use `Authorization: Basic base64(user:pass)` (`BifrostClient.ts:123-130`). In stadeum we also set `BIFROST_ADMIN_PASS` ourselves, so this call is a fallback/check.

### b. Org key + trust registry
1. Org keypair: **secp256k1**, 32-byte private, 33-byte compressed public, hex (`macaroon-org-keys.ts:63-153`; gatekey `ecdsaPublicKey`). `org_id` stable string (Hive uses `gh_<login>`; stadeum: e.g. `stadeum_<orgslug>`).
2. `GET {gw}/_plugin/trust/status` → `{claimed, org_count, orgs[], seed_source, last_modified, realm_id?}`.
3. If `realm_id` differs: `PUT {gw}/_plugin/trust/realm_id` `{realm_id}`.
4. If `org_id` in `orgs`: `GET {gw}/_plugin/trust/{org_id}` → `{org_id, pubkey, ...}`; matching pubkey = done.
5. Else `POST {gw}/_plugin/trust` `{org_id, pubkey, issuer_url, revocation_poll_seconds: 60}`.
(`trust-reconciler.ts:121-375`.) Optional, best-effort: `POST {gw}/_plugin/agents` `{source, agents:[{name:"strut-agent"},{name:"strut-assistant"}]}`.

### c. Customer + virtual key per user (`reconciler.ts:87-456`)
- Name = actor string (Hive `${login}-${userId}`, `reconciler.ts:736-742`). **Same string is the macaroon `user_id` and the Strut actor.**
- Find: `GET {gw}/api/governance/customers?search=<name>&limit=50` (exact name; oldest wins). Create: `POST {gw}/api/governance/customers` `{name, budget:{max_limit:1000, reset_duration:"1d"}, rate_limit:{request_max_limit:1000, request_reset_duration:"1m"}}`; a 400 matching `duplicate key|already exists|UNIQUE constraint` = race, re-read.
- Providers: `GET {gw}/api/providers` → desired = `["anthropic","openai","openrouter","gemini","xai"]` ∩ configured (fallback all).
- Find VK: `GET {gw}/api/governance/virtual-keys?search=<name>&customer_id=<id>&limit=50`. Create: `POST {gw}/api/governance/virtual-keys` `{name, description, customer_id, provider_configs:[{provider, allowed_models:["*"], key_ids:["*"]}]}` → `{virtual_key:{id, value:"sk-bf-…"}}`. `key_ids:["*"]` is required.
- `PUT /api/governance/virtual-keys/{id}` replaces the whole provider set (re-send existing configs with ids).
- Store VK value encrypted + vkId + customerId.

### d. Mint the macaroon (`macaroon-issuer.ts:154-305`, `strut-delegation.ts:253-272`)
- User key: **ed25519**, 32-byte random seed, `ed25519PublicKey(seed)`, private encrypted at rest (`macaroon-user-keys.ts:108-156`).
- `iat = now`, `exp = now + 60 days`, ISO strings; nonces = 16 random bytes hex.
- `ua = signUserAuthorizationSingle({user_id: actor, user_pubkey:{alg:"ed25519", key:userPubHex}, agents:["strut-agent"], iat, exp, nonce}, orgPriv)`
- `inv = signInvocation({agents:["strut-agent"], run_id: randomUUID(), max_cost_usd: 10000, max_steps: 0, iat, exp, nonce}, userPriv)`
- `token = encodeMacaroon({v:1, org_id, user_authorization: ua, invocation: inv, attenuations: []})` (base64url).
- Self-test with gatekey `verify(decodeMacaroon(token), {type:"single", key:{alg:"ecdsa-secp256k1-sha256", key: orgPubHex}}, new Date())` before pushing.
- Strut's shape check (`strut/src/mothership.ts:123-161`): v=1, no attenuations, inv.agents has `strut-agent`, max_steps 0, max_cost_usd>0, run_id set, valid exps.

### e. Push to Strut (`strut-delegation.ts:194-245,301-361`)
- `PUT {strut}/llm/delegations/{encodeURIComponent(actor)}`, headers `Content-Type: application/json`, `Authorization: Bearer` (shared token), body `{macaroon, apiKey: vk.value, baseUrl: gatewayRoot}` (`baseUrl` = gateway ROOT, `^https?://`) → `{actor, exp, delegationId}`.
- `GET {strut}/llm/delegations` lists (404 = mothership not mounted); `DELETE` removes; `GET /llm/mothership` → `{enabled:true}`.
- Renewal: re-push if missing or past half-life (`isPastHalfLife`, `:501`); re-mint within 15 days of exp.

## Strut side

- Mothership routes mount only when `STRUT_MOTHERSHIP=1`; stored in `{STRUT_WORKSPACE}/mothership.json`, encrypted with `STRUT_SECRET_KEY` (`strut/src/server.ts:24-56`). `stack/stadeum.yml` sets both flags and a `STRUT_SECRET_KEY` of its own.
- `STRUT_MOTHERSHIP_REQUIRED=1` → LLM call with no principal or no delegation throws (`mothership.ts:299,304`).
- Actor: `x-strut-actor` header is honoured only when `STRUT_API_KEY` is set and the Bearer matches (`auth.ts:73-77`). A browser session's actor is its sign-in ticket's (below).
- Actor secrets: `PUT /actors/:actor/secrets/:NAME` `{value}` (`createStrut.ts:1558-1597`) — e.g. `GITHUB_TOKEN` for the code pack.
- Runs: `POST /workflows/:name/run` `{input?, params?, runId?, callback?:{url}}` → `202 {runId}`; SSE `GET /workflows/:name/runs/:runId/stream` (ends with `event: done`); `GET …/events`, `GET …/runs/:runId`. Chat: `POST /chat`, `GET /chat/:id/stream?turn=`.

## Embedding the Strut UI

- Stadeum: per page load, `POST {strut}/auth/ticket {actor, role}` (Bearer shared token; `role` the person's stadeum role, `admin` | `member`) → `{ticket, expiresAt}`, a sign-in ticket good once for 60 s; iframe `{STRUT_PUBLIC_URL}/?ticket=<ticket>&embed_origin=<stadeum origin>[&wf=&run=]` (`ui/src/lib/strut/client.ts`). Strut's UI trades it at `POST /auth/session {ticket}` for its own `SameSite=Lax` session cookie as that actor, with that role, and takes it off the URL (strut `specs/API.md` §13.1).
- The cookie reaches the frame only when strut and stadeum-ui are the same site: `strut.$HOST` under `$HOST` (`stack/caddy/Caddyfile`).
- `?embed_origin=` makes strut's UI post `{type:"strut:location", params:{wf,run,v,chat,elicit}}` to the parent (`web/src/embed.ts`).
- Hive instead mints mcp's `POST {mcp}/mint-token` JWT and frames `{mcp}/lab/?key=<jwt>` (Hive `src/services/strut-embed.ts:45-136`).
- Gotcha: a raw `?key=STRUT_API_KEY` gives the browser admin rights and NO actor. Never hand the key to a browser.

## gatekey

npm `gatekey@0.1.1`, ESM-only (source: stakgraph `gateway/auth/ts`). Exports used: `signUserAuthorizationSingle`, `signInvocation`, `encodeMacaroon`, `decodeMacaroon`, `verify`, `ed25519PublicKey`, `ecdsaPublicKey`, `bytesToHex`, `hexToBytes`.

## Hive code worth copying (replace Prisma with stadeum's store)

| File | Lines | What |
| --- | --- | --- |
| `src/services/bifrost/BifrostClient.ts` | ~295 | Basic-auth governance client |
| `src/services/bifrost/BifrostPluginClient.ts` | ~240 | Bearer `/_plugin/*` client (drop hive callback) |
| `src/services/bifrost/bootstrap.ts` | ~100 | admin credentials |
| `src/services/bifrost/trust-reconciler.ts:233-375` | ~140 | trust sync |
| `src/services/bifrost/reconciler.ts:288-573,736-754` | ~300 | customer + VK |
| `src/services/bifrost/macaroon-issuer.ts:154-305` | ~150 | mint |
| `macaroon-org-keys.ts:114-123`, `macaroon-user-keys.ts:125-128` | ~20 | keygen |
| `src/services/bifrost/strut-delegation.ts:161-245,387-505` | ~200 | push/list/renew |
| `src/services/strut-actor-secret.ts` | ~100 | actor secrets |
| `src/services/strut-embed.ts:45-136` | ~90 | embed via mint-token |
| `src/services/bifrost/constants.ts` | — | defaults |

## Org identity file (phase 2 contract for stadeum-ui)

The stack, not stadeum-ui, makes the org key. `stack/bootstrap/org-identity.mjs`
runs as the one-shot `bootstrap` service after bifrost is healthy, and
stadeum-ui starts only after it exits 0 (`depends_on: service_completed_successfully`).

- **Where:** docker volume `org` (`<project>_org`, e.g. `stadeum_org`),
  mounted read-write at `/org` in `bootstrap` and read-only at `/org` in
  `stadeum-ui`. Path: `/org/org-key.json`, passed to the UI as
  `STADEUM_ORG_KEY_FILE=/org/org-key.json`. Mode `0644`, owner root (the UI
  runs as a non-root user; the private half is encrypted).
- **Format** (`v: 1`):

  ```json
  {
    "v": 1,
    "org_id": "stadeum_<STADEUM_ORG_SLUG>",
    "realm_id": "<STADEUM_ORG_SLUG>",
    "alg": "secp256k1",
    "pubkey": "02…  (33-byte compressed public key, lowercase hex)",
    "privkey_enc": "v1:<iv b64url>:<tag b64url>:<ciphertext b64url>",
    "created_at": "2026-11-04T22:21:47.815Z"
  }
  ```

- **`privkey_enc`** is byte-for-byte the format of `ui/src/lib/crypto.ts`
  `encryptField("orgPrivkey", privHex)`: AES-256-GCM, key
  `STADEUM_ENCRYPTION_KEY` (32 bytes, hex or base64; the same value is passed
  to `bootstrap` and `stadeum-ui`), 12-byte IV, field name `orgPrivkey` as
  AAD, plaintext = the 32-byte private key as 64 lowercase hex chars. So the
  UI can copy it straight into `Org.orgPrivkeyEnc`, or
  `hexToBytes(decryptField("orgPrivkey", file.privkey_enc))`.
- **Lifecycle:** written once. Re-runs keep the key, check it decrypts and
  matches `pubkey`, and only relabel `org_id`/`realm_id` if
  `STADEUM_ORG_SLUG` changed (as `ensureOrgKeys` does). Losing
  `STADEUM_ENCRYPTION_KEY` means re-keying: delete the file and re-run.
- **Trust registration** is done by bootstrap too: `realm_id` = slug,
  `POST /_plugin/trust {org_id, pubkey, issuer_url: STADEUM_ISSUER_URL (may be ""), revocation_poll_seconds: 60}`
  when the registered pubkey differs, then the agent catalog seed. Like the
  UI's `ensureOrgTrust`, a pubkey match is "done", so the two never fight over
  `issuer_url`.
- **What stadeum-ui must change** (not done here; `ui/` is out of scope):
  `ensureOrgKeys()` (`ui/src/lib/mothership/keys.ts`) must, when the `Org`
  row has no key, import `STADEUM_ORG_KEY_FILE` instead of calling
  `generateOrgKeypair()`, and refuse to generate when the env var is set but
  the file is missing. Today it generates its own key, and its
  `ensureOrgTrust()` would then replace bootstrap's pubkey in bifrost; the
  next `bootstrap` run would put it back, and every macaroon minted by the
  loser fails verification (401).

## Answers (phase 2, from gateway source at stakgraph `643e12fd` — no gateway changes since the `stakgraph-gateway:latest` image of 2026-10-23 — and the live stack)

- **`realm_id` is not required.** `CheckRealmMembership`
  (`gateway/internal/auth/enforcement.go:124-150`) only rejects when the
  macaroon carries `realm_budgets` and the gateway's realm is not among them.
  Our macaroons carry none, so they pass with or without a realm. Stadeum
  sets it (= slug) anyway, as Hive and the UI do.
- **An empty `issuer_url` is accepted.** It is validated only when non-empty
  (`gateway/internal/trust/types.go:175`). Live: the row reads back
  `"issuer_url":""`.
- **The agent catalog is not needed** to accept a macaroon. It is a neo4j
  registry for the dashboard (`internal/adminapi/catalog.go`); nothing on the
  inference path (`internal/hooks/llm_prehook.go`, `internal/auth/*`) reads
  it. Bootstrap seeds it best-effort; it succeeds on this stack.
- **`/_plugin/admin-credentials` exists** in this image
  (`internal/adminapi/server.go:213`, Bearer provisioning token) and returns
  `{admin_username:"admin", admin_password: BIFROST_ADMIN_PASS}`.
- **Enforcement flags:** both on. `BIFROST_PLUGIN_ENFORCE_MACAROONS=true`
  turns verification failures into 401s (`x-macaroon header is required`
  for a call without one). `BIFROST_PLUGIN_ENFORCE_BUDGETS=true` turns the
  cap walk into 402s, and only works with macaroons enforced
  (`internal/auth/config.go`, `BudgetsEnforced`). The cap walk checks
  `cost:run:<run_id>` for every layer: the delegation's own `run_id`
  (person ceiling = invocation `max_cost_usd`) and Strut's per-run link (run
  cap). bifrost's own `enforce_auth_on_inference: true` (baked config) also
  requires a VK.
- **`baseUrl: http://bifrost:8181` is right** for the delegation: strut
  runs on the same network (UI hand-over question 1).
- **Delegation ceiling must be at least Strut's run cap.** Strut gives every
  run a cap (workflow `maxRunCostUsd`, else `STRUT_RUN_MAX_COST_USD`, else
  $100; strut `src/mothership.ts:46,192-205`) and refuses a run whose cap is
  above the ceiling: "workflow cap $100 exceeds the delegation ceiling". The
  UI's default ceiling ($10,000) is fine; `STRUT_DELEGATION_MAX_COST_USD`
  below 100 breaks every uncapped workflow.
- **Customer reads return `budgets[]`**, not `budget`
  (`GET /api/governance/customers/:id` → `customer.budgets[0].current_usage`).
  `POST` with `budget:{…}` still works. The UI's `BifrostCustomer.budget`
  type only matters if it reads usage.

## Unknowns (phase 0; answered above)

- Whether the gateway requires `realm_id` / the agent catalog before accepting a macaroon (Hive does both, best-effort).
- Whether an empty `issuer_url` is rejected.
- `/_plugin/admin-credentials` exists only in the stakgraph-gateway wrapper image (which stadeum uses).
