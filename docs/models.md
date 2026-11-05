# Models: who picks, where the keys live

A plan, 2026-11-05. It covers who chooses a model at each level, what an
admin adds, where each provider's key lives, and how Maple and Numes fit.
It was written against stadeum `main` 30a7c61, strut `main` 5c3fb86,
stakgraph's aieo 0.2.7, and the gateway: bifrost `transports/v2.2.2`
with `core` v1.10.1. "Live" means a read-only call to the local dev
stack's bifrost. Evan ruled on its questions the same day: see
"Rulings" at the end. Every work item is built: "Built so far" under
"Work items" says where.

Refs: `strut …` is stakwork/strut. `aieo …` is
stakgraph `mcp/src/aieo/src/`. `gateway …` is stakgraph `gateway/`.
`gatekey …` is stakgraph `gateway/auth/ts/src/`. `bifrost-core …` is
`github.com/maximhq/bifrost/core@v1.10.1`. Bare paths are this repo.

## The answers

1. **A Jamie thing or an org default? Both.** The admin sets which
   models people may use and the org default, on stadeum's Models page.
   A person picks their own in Jamie, whose picker already exists. A
   workflow or a step may pin a model. Section "The levels" says which
   wins. The gateway's allowlist caps every level.
2. **An admin adds a provider** on one page: pick the provider, paste the
   key, press Test, and it is done. The key goes straight to the
   gateway's admin API, with no restart. The provider's known models
   arrive already allowed; the admin can untick any of them.
3. **The keys live in the gateway** and nowhere else: bifrost's config
   store, on the `bifrost` volume. Strut learns the allowed models and
   the default from `STRUT_MODELS` and `STRUT_DEFAULT_MODEL`, which
   stadeum pushes through strut's HTTP API. The gateway enforces the list
   through each person's virtual key.
4. **Maple and Numes go through the local gateway** on a Stadeum box,
   like every other provider. This takes one aieo change, one strut
   change and a price door in the gateway. Confidentiality is kept:
   Maple's proxy is still the only hop to the enclave.

## What was true when this was written

| Fact | Where |
| --- | --- |
| Provider keys reach bifrost from `.env`, through its baked config's `env.*` references | `stack/stadeum.yml:117-123`, `gateway data/config.json:14-65` |
| Bifrost keeps providers and keys in its own SQLite config store, on the `bifrost` volume | `gateway data/config.json:94-100` |
| A provider's URL and keys can change on a running gateway | `scripts/e2e/mothership-e2e.mjs:148-163`; live `GET /api/providers/anthropic/keys` → `{id, name, models, weight}` |
| Each of the five built-in providers always has one key slot that points at `env.*`. With nothing in `.env`, that slot is empty | live: every built-in provider's key `value` is `{value: "", ref: "env.<NAME>", type: "env"}` on a stack with no provider key set |
| Bifrost's log retention and content logging can be changed at run time | live `GET /api/config` → `client_config.log_retention_days: 365`, `disable_content_logging: false`, plus a `restart_required` flag |
| Bifrost has OpenAI-compatible custom providers | `bifrost-core schemas/provider.go:538-546` (`base_provider_type`, `is_key_less`, `request_path_overrides`) |
| A private-network upstream such as `maple:8080` needs `allow_private_network` | `bifrost-core schemas/provider.go:76` |
| Each person's virtual key may call every model of every configured provider | `ui/src/lib/mothership/virtual-key.ts:110,151` (`allowed_models: ["*"]`) |
| Stadeum's provider list is a fixed five | `ui/src/lib/mothership/types.ts:3`, `constants.ts:23` |
| A macaroon can cap spend and steps, but it cannot name models | `gatekey types.ts:143-175` (agents, run_id, max_cost_usd, max_steps, budget, exp) |
| The gateway prices a call from its config `model_pricing`, then from bifrost's datasheet. Otherwise the call counts as **$0**, with a log line | `gateway internal/hooks/llm_posthook.go:202-234`, `internal/auth/pricing.go:34-47` |
| `model_pricing` is read once, from the plugin's config | `gateway internal/auth/config.go:192-206` |
| The datasheet has no Maple or Numes rows | live `GET /api/models?provider=maple` → `total: 0` (anthropic 23, openrouter 689) |
| Bifrost's log keeps each request's prompt, for 365 days | live `/api/logs`: `content_hidden: false`, a `responses_input_history`; `gateway data/config.json:4` |
| Strut does not ask the gateway hook about Maple or Numes calls (aieo's `BASE_URL_ENV`) | `strut src/llm.ts:108-116` |
| `STRUT_MOTHERSHIP_REQUIRED` is checked only inside that hook | `strut src/mothership.ts:297-306` |
| A Maple or Numes call then reads `MAPLE_*` / `NUMES_*` from strut's secret store or env | `aieo resolve.ts:244-256`, `strut AGENTS.md:507-508` |
| Anyone signed in to strut can write its secret store: a ticket session is full scope | `strut src/createStrut.ts:4318`; the strut#530 note |
| `GET /llm/models` marks a model `available` when strut holds a key for its provider | `strut src/llm.ts:428-451` |
| It lists only aieo's aliases: one Maple and one Numes model of the 7 and 8 that aieo knows | `aieo resolve.ts:58-72`, `provider.ts:246,354` |
| Jamie has a model picker. It lists `available` models only, is remembered per viewer, and is sent as the turn's `params.model` | `strut src/apps/jamie/src/components/Composer.tsx:34,190-198`, `hooks.ts:124-129,167-172` |
| The orchestrator template pins `params.model: claude-sonnet-5-5` | `strut src/workflows/orchestrator.yaml:105,220-221` |
| A host config's `model: null` removes that pin, so the workflow runs on `STRUT_DEFAULT_MODEL` | `strut src/job-seed.ts:48-51,86-87`, `AGENTS.md:491` |
| The `agent` step falls back to `STRUT_DEFAULT_MODEL`, read from the secret store and then env, which Peel sets at run time | `strut src/steps/core/agent.ts:1385-1394` |
| The builder chat reads `STRUT_CHAT_MODEL` once, at boot | `strut src/createStrut.ts:1218-1219` |

**Consequence today:** on Stadeum, Jamie's picker shows "Default" and
nothing else. Every turn runs on `claude-sonnet-5-5`, whatever the admin
wants. A Maple or Numes call fails for lack of a key. Once any person
pastes such a key under strut's Secrets, those calls leave the box with
nobody billed and no cap. That is the one gap in "every model call
through the gateway".

## The levels

| Level | Who sets it | Stored | How it reaches the call |
| --- | --- | --- | --- |
| Providers and their keys | admin, Models page | gateway config store (`bifrost` volume) | the gateway attaches the key upstream |
| Models people may use | admin, Models page | stadeum DB, `Org.models` | gateway: each person's VK `allowed_models`, enforced. Strut: `STRUT_MODELS`, displayed |
| Org default | admin, Models page | stadeum DB, `Org.defaultModel` | strut: `STRUT_DEFAULT_MODEL`, in the secret store (the door Peel uses) |
| A person's pick | the person, in Jamie's composer | strut, the app's per-viewer state | the turn's `params.model` |
| A workflow's `params.model` | its author | the workflow, in strut's graph | `{{ params.model }}` in its steps |
| A step's `model:` | its author | the step, in strut's graph | `resolveModel` |

**What wins, for each call:**
1. a step's literal `model:`;
2. the run's `params.model`, which is the person's pick in Jamie;
3. the workflow's `params.model`;
4. the org default;
5. strut's built-in fallback.

The gateway's allowlist is not a level: it caps all of them. A call for a
model the person's key does not allow fails at the gateway, and strut
says so in plain words.

Three notes on this order:

- **It matches strut's settings order.** Strut's settings run step >
  run > workflow > deployment (`strut AGENTS.md:114`). The model keeps
  riding `params` and `STRUT_DEFAULT_MODEL` instead of becoming a
  registered setting. Moving it would be a strut refactor that gains
  Stadeum nothing.
- **Strut's shipped workflows would otherwise beat the org default.**
  Job, orchestrator and builder pin `claude-sonnet-5-5`. Stadeum gives
  strut a host config with `model: null` for those three, as Peel does.
- **A person's pick stays in Jamie.** No stadeum page draws it (rule 2).
  Hive's per-person `chatAgentModel` became this picker
  (`strut plans/jamie-app.md:33,620-624`).

## Adding a provider

A Models page under Organisation, beside Members, Status and Apps
(`ui/src/components/rail.tsx:78-85`).

1. **Providers.** The page lists what the gateway has. Each provider
   shows bifrost's masked preview of its key, whether the key works, and
   Set, Test and Remove: Anthropic, OpenAI, Google, xAI and OpenRouter,
   then Maple and Numes, then each provider an admin added under
   "Another provider" (any OpenAI-compatible API: a name, its address,
   its key). Removing a custom provider removes it whole.
   - **Where the call goes.** stadeum-ui calls the gateway's admin API
     with the credentials it already holds
     (`ui/src/lib/mothership/admin-credentials.ts`):
     - a built-in provider: the pasted key **replaces** the empty
       `env.*` slot in place, under the slot's name:
       `PUT /api/providers/{p}/keys/{id} {name, value, models, weight}`.
       An update keeps the key's stored config hash (bifrost
       `handlers/provider_keys.go:656`), so bifrost keeps it at every
       restart while its config.json is unchanged; a deleted slot comes
       back empty at the next start (`lib/config.go`,
       `reconcileProviderKeys`). A provider with no slot gets a `POST`;
     - Numes, Maple or Other: **two calls**. First
       `POST /api/providers {provider, network_config: {base_url}, custom_provider_config: {base_provider_type: "openai"}}`,
       then the key with `POST /api/providers/{name}/keys {name, value, models, weight}`.
       The first call's payload has no `keys` field
       (`handlers/providers.go:125-136`), so a key sent in it is dropped
       without an error, and every call then fails with
       `no_key_supports_model` (stakwork/stakgraph#1844's e2e).
     - Maple's `base_url` is `http://maple:8080`, with
       `allow_private_network: true`.
     - Each person's virtual key needs a `provider_configs` entry for the
       new provider. Today's provider list is the five built-ins
       (`constants.ts`, `desiredProviders`), so item 6 widens it to the
       custom providers the gateway has.
   - **No restart.** Bifrost's config store holds the change, as the
     e2e already shows.
   - **The key** is never written to stadeum's database or to strut. To
     rotate it, paste the new one over it.
   - **Test** asks bifrost to list the provider's models with the key
     (`POST /api/providers/{p}/keys/{id}/refresh-models`): no model call,
     no cost. Bifrost answers `success`, or `list_models_failed` with the
     provider's own reason, which the row shows. Saving a key runs it too.
     Checked live: a bad xAI key came back "Incorrect API key provided."
2. **Models.** For each provider the page shows the models in strut's
   catalog (`GET /llm/models`, with context windows). Prices come from
   bifrost's datasheet (ruling 7), so the catalog gives a `pricing` only
   where a model has its own rate: Maple's and Numes' tables
   (stakwork/strut#542). An absent price means "unknown", not free.
   - **Adding a provider allows its catalog models at once**, so "paste
     a key, done" holds. That is Numes' 8 free models, Maple's 7, and
     the named models of the others. The admin unticks what the org
     should not use.
   - **Any other id can be typed in**: the gateway's catalog knows 689
     OpenRouter models. An Other provider's models are typed in, each
     with an optional price per million tokens. A blank price shows as
     "free: no cap applies".
   - **One model is starred as the org default.** Until the admin picks
     one, it is strut's own default when its provider has a key, else a
     keyed provider's default model.
3. **Save carries it out at once**, and the upkeep pass repeats it a
   minute after start and every six hours:
   - every person's VK gets `allowed_models` per provider from
     `Org.models`;
   - strut gets `STRUT_MODELS` and `STRUT_DEFAULT_MODEL` through
     `PUT /secrets/:name`;
   - the gateway gets a price row for every allowed model its datasheet
     cannot price: `PUT /_plugin/pricing` (stakwork/stakgraph#1844), keyed
     `<provider>/<id>` (`maple/gemma4-31b`). The route replaces the whole
     table. The rows for Maple and Numes come from strut's catalog, and
     an Other model's from the price the admin typed. A row of zeros marks
     a free model.

**Keys come in only through this page.** The five provider-key rows
leave `.env.example` and `stack/stadeum.yml` (`.env.example:56-60`,
`stadeum.yml:117-123`):
- **One way in.** With a second way, "which key is live" has two
  answers.
- **No copies on the host.** A key in `.env` is a plaintext file on the
  host, and it shows in `docker inspect` of the bifrost container.
- **A provider is the admin's choice**, like a member, not a setting of
  the box.
- **Scripted installs** call the gateway's admin API, with the admin
  password `.env` already holds.

**Maple's proxy runs in every stack.** It reads prompts in plaintext,
holds no key and needs no port
(`strut deploy/voice/docker-compose.yml:77-98`). stadeum-ui cannot start
a container: the Docker socket is mounted in `ops` alone (rule 4).
- **The service copies the voice demo's hardening:** pinned `0.4.5`,
  read-only, `cap_drop: [ALL]`, 256 MB, no route in Caddy.
- **Turning Maple on is a pasted key**, as for every other provider.
  With no Maple key in the gateway, nothing calls the proxy.

**aieo moving into strut helps.** The catalog becomes strut's own, and a
new model or provider is one strut PR. Today it takes four steps
(`strut plans/aieo-in-strut.md`). Stadeum reads the catalog through
`GET /llm/models` and keeps no copy, just as its list of apps comes from
strut.

## Maple and Numes through the gateway

**The decision.** On a Stadeum box, both go through the local gateway.
- **One path.** Every call gets the per-person cap, the attribution and
  the kill switch, and every key sits in one place.
- **Confidentiality is kept.** The gateway is on the same box and
  network. Maple's proxy is still the only hop to the enclave, and it
  still encrypts to it. Strut already keeps every prompt on this box.
- **Bifrost's log is one more plaintext copy**, included in the backup.
  It stays: the spend pages and debugging read it. Stadeum keeps it 60
  days instead of the image's 365, by setting
  `client_config.log_retention_days` through bifrost's `PUT /api/config`.
- **Numes' free models** are priced 0. They cost nothing, and no cap
  bites. Its paid models need a price row.

**What changes:**

- **aieo** (in strut once it moves):
  - A routed call to an OpenAI-compatible provider goes to the gateway's
    `/openai/v1` with the model id `<provider>/<id>`. The OpenRouter and
    xAI branches already do this (`aieo provider.ts:965,982`), and
    bifrost picks the custom provider of that name.
  - The own-endpoint path (`provider.ts:34-51,991-1012`) stays for hosts
    with no gateway: Peel and the voice demo.
  - A routed name whose provider aieo does not know (`acme/llama-4`)
    becomes an OpenAI chat model on that route, so an admin's Other
    provider needs no aieo release. Today that name is "Unknown LLM
    provider" (`resolve.ts:129`).
- **strut** deletes the special case at `src/llm.ts:110-115` and asks
  the hook for every provider. The hook decides, as it already does for
  the others:
  - **with a delegation**, the call goes through the gateway;
  - **without one**, it goes direct, or is an error under
    `STRUT_MOTHERSHIP_REQUIRED=1`;
  - **with no hook** (Peel, the voice demo), nothing changes.

  No Hive swarm calls Maple or Numes directly. A swarm that wants them
  later adds them to its own gateway, as Stadeum does.
- **The gateway** needs a runtime door for price rows. Without a row, a
  Maple call counts as $0 against every cap. stakwork/stakgraph#1844 adds it, and
  its e2e on the real image confirms the route:
  - **Routing:** `model: "maple/gemma4-31b"` on
    `/openai/v1/chat/completions` reaches the provider named `maple`, and
    the upstream gets `gemma4-31b`.
  - **Streaming:** usage arrives when streaming.
  - **Restarts:** custom providers, their keys and the price table all
    survive one.
- **Stream flags:** maple-proxy 0.4.5 passes Maple's stream through
  unchanged, `[DONE]` included, so it needs neither of bifrost's stream
  flags.
  - An Other upstream that skips `[DONE]` and keeps the connection open
    needs both `does_not_send_done_marker` and `wait_for_usage`.
  - With neither flag, each answer waits for the idle timeout (60 s).
  - With the first flag alone, its usage is dropped and the call counts
    $0.

## How strut answers "available"

**The host says.** `STRUT_MODELS` is a JSON list of canonical names,
read from the secret store and then env, like `STRUT_DEFAULT_MODEL`.
- **When it is set**, `GET /llm/models` marks exactly those models
  available, and its `default` is `STRUT_DEFAULT_MODEL`.
- **The list covers every model aieo knows**, each with its context
  window, plus any listed name aieo has no row for. Stadeum's admin page
  and Jamie's picker read this one route. A model has a `pricing` only
  where its own rate is known (Maple, Numes); the rest come from bifrost's
  datasheet once aieo moves in (ruling 7).
- **When it is unset**, today's key check applies, on Peel and on
  swarms.

**Strut never asks the gateway.**
- It holds no admin credentials.
- The list is the org's and one for everyone, so the host can tell strut
  once.
- The gateway still enforces the list: strut only shows it.

**Jamie and other apps.** Jamie is a strut app, so stadeum never draws
its picker (rule 2). It sees the org list through strut:
- **Jamie's picker** calls the `llm/models` step, which its manifest
  grants (`strut src/apps/jamie/app.yaml:16`). That step returns the
  same list as `GET /llm/models`.
- **Jamie keeps only `available` models** (`Composer.tsx:197`). With
  `STRUT_MODELS` set, those are exactly the org's list.
- **"Default" sends no `params.model`**, so the turn runs on the org
  default.
- **Jamie shows the whole list.** It is the person's own assistant, and
  the list is what the admin allowed.
- **An app that wants fewer filters the same answer in its own code**,
  or its workflow pins a model. Neither strut nor stadeum keeps a list
  per app.
- **An app cannot widen the list.** The gateway refuses any model that
  is not on it, whatever the app sends.

**Known limit.** Both settings sit in strut's deployment secret store,
which anyone signed in can write. Editing them changes what Jamie shows,
not what the gateway lets through, and stadeum's next reconcile puts
them back.

## Work items

In order, one PR each.

| # | Repo | What | Needs |
| --- | --- | --- | --- |
| 1 | stadeum | The Models page, providers and keys: list, add (the five built-ins, replacing the empty `env.*` slot), Test, delete, all through the gateway's admin API. The provider list becomes what the gateway has, not a fixed five (`types.ts:3`, `constants.ts:23`, `virtual-key.ts:128-139`). The provider-key rows leave `.env.example` and `stadeum.yml`. Bifrost's log retention is set to 60 days on the upkeep pass | — |
| 2 | strut | `STRUT_MODELS`. `/llm/models` lists every model aieo knows, with context windows, and prices where a model has its own rate. The builder chat's default reads `STRUT_DEFAULT_MODEL` (`createStrut.ts:1218`). Jamie drops a remembered pick that is no longer listed. The gateway's "model not allowed" is explained in plain words. Open: stakwork/strut#542 | — |
| 3 | stadeum | Allowed models and the org default: `Org.models` and `Org.defaultModel` (a migration). Each VK's `allowed_models` comes from them. Stadeum pushes `STRUT_MODELS` and `STRUT_DEFAULT_MODEL`, and adds `stack/strut/host-config.json` (`model: null` for job, orchestrator and builder) as `STRUT_HOST_CONFIG` | 2 |
| 4 | strut, with aieo inside | Routed OpenAI-compatible providers (Maple, Numes, any name) on the gateway's `/openai/v1`. `llm.ts` asks the hook for every provider; the `BASE_URL_ENV` special case goes. If aieo has not moved yet, the aieo half lands in stakgraph, with a strut bump | the aieo move |
| 5 | gateway | `PUT /_plugin/pricing` (Bearer), kept on the `bifrost` volume, checked after the config's `model_pricing` and before the datasheet. Tests: a custom provider added through `/api/providers` routes `/openai/v1` with `maple/<id>` and reports usage when streaming. A key that replaced the `env.*` slot, and a custom provider, both survive a restart with the baked `config.json`. Open: stakwork/stakgraph#1844 | — |
| 6 | stadeum | Numes, Maple and Other on the page, each added in two calls (provider, then key). The provider list widened to the gateway's custom providers. The `maple` service in every stack (`stadeum.yml`). Price rows (`PUT /_plugin/pricing`, keyed `<provider>/<id>`) from strut's catalog for Maple and Numes, and from the admin's typed price for Other. `mothership-e2e.sh` gains a fake OpenAI-compatible provider whose calls are billed per person | 3, 4, 5 |

Items 1, 2 and 5 can run at the same time.

**Built so far.** Items 1 and 3 in stakwork/stadeum#7, beside this
plan; item 2 in stakwork/strut#542, item 4 in stakwork/strut#545, item 5
in stakwork/stakgraph#1844 (gateway v0.4.398), all merged; item 6 in the
PR after #7.
- **Item 6**: Maple and Numes on the page, added on their first key;
  "Another provider"; every person's key widened to the gateway's custom
  providers; the price table pushed with the rest (Maple's and Numes'
  rates from strut's catalog, an added provider's model from the price
  the admin types beside it); the `maple` service; the gateway pinned at
  v0.4.398; the gateway e2e's section 5, an OpenAI-compatible provider
  billed to the person and priced from the table.
- **Item 1**: the page, its gateway calls, the 60-day log, and the
  provider keys out of `.env`. The gateway e2e asks bifrost whether it
  holds an Anthropic key instead of reading `.env`.
- **Item 3**: `Org.models` and `Org.defaultModel`; every person's key
  narrowed to the list; `STRUT_MODELS` and `STRUT_DEFAULT_MODEL` written
  to strut; the host config. Strut's settings read falls back to env
  (`capabilities.ts:72-85` at strut 2fe953a), so the compose value of
  `STRUT_DEFAULT_MODEL` holds until stadeum first writes it.
- **On a box**, Jamie shows the org's list once strut's `stable` carries
  #542, and Maple, Numes and added providers are called once it carries
  #545 (strut `bbfcdc0` and later).
- **Checked against the real bifrost** (the local stack, v2.2.2), on an
  empty xAI slot, then restored: a pasted key replaces the slot in place
  (same id and name, now `plain_text`), only a masked preview comes back,
  the check reaches the provider, and a remove leaves `keys: null`.
- **The retention write** also writes out defaults the GET leaves unset
  (`prefer_idp`, `headers`, 3600) and the deprecated mirrors of
  `enforce_auth_on_inference`. That changes no behavior.

## Rulings

Evan, 2026-11-05:

1. **One list of allowed models per org.** Apps may filter it, but may
   not widen it.
2. **Maple's proxy runs in every stack.** It costs little when unused.
3. **Provider keys leave `.env`.** Evan asked for a recommendation, and
   this is it: "Keys come in only through this page" gives the reasons.
4. **The gateway log stays, kept 60 days** on Stadeum.
5. **No Hive swarm calls Maple or Numes directly.** Routing them through
   a gateway stays an option, so strut drops the special case outright.
6. **A new provider's catalog models arrive already allowed.** This was
   the question about Numes' free models "on for everyone by default".
   With one org list, "for everyone" adds nothing: the question was only
   whether they start ticked. Evan did not rule on this; it is the
   plan's default, and flipping it is one line.
7. **Prices and limits come from bifrost's datasheet**, as data, not as
   tables in code. This is ruling 5 of strut's `plans/aieo-in-strut.md`
   (stakwork/strut#540), and it applies once aieo moves into strut.
   - A model priced nowhere keeps its provider's flat rate in strut.
   - Maple's and Numes' tables stay until the datasheet carries them.
   - Stadeum pushes the gateway's price rows for them from those
     tables.
