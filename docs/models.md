# Models: who picks, where the keys live

A plan, 2026-11-05. It covers who chooses a model at each level, what an
admin adds, where each provider's key lives, and how Maple and Numes fit.
It was written against stadeum `main` 30a7c61, strut `main` 5c3fb86,
stakgraph's aieo 0.2.7, and the gateway: bifrost `transports/v2.2.2`
with `core` v1.10.1. "Live" means a read-only call to the local dev
stack's bifrost.

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
   gateway's admin API, with no restart. The admin then ticks the models
   people may use.
3. **The keys live in the gateway** and nowhere else: bifrost's config
   store, on the `bifrost` volume. Strut learns the allowed models and
   the default from `STRUT_MODELS` and `STRUT_DEFAULT_MODEL`, which
   stadeum pushes through strut's HTTP API. The gateway enforces the list
   through each person's virtual key.
4. **Maple and Numes go through the local gateway** on a Stadeum box,
   like every other provider. This takes one aieo change, one strut
   change and a price door in the gateway. Confidentiality is kept:
   Maple's proxy is still the only hop to the enclave.

## What is true today

| Fact | Where |
| --- | --- |
| Provider keys reach bifrost from `.env`, through its baked config's `env.*` references | `stack/stadeum.yml:117-123`, `gateway data/config.json:14-65` |
| Bifrost keeps providers and keys in its own SQLite config store, on the `bifrost` volume | `gateway data/config.json:94-100` |
| A provider's URL and keys can change on a running gateway | `scripts/e2e/mothership-e2e.mjs:148-163`; live `GET /api/providers/anthropic/keys` → `{id, name, models, weight}` |
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
   shows its key's last four characters and a Test button. "Add a
   provider" offers Anthropic, OpenAI, Google, xAI, OpenRouter, Numes,
   Maple, or "Other (OpenAI-compatible)". The admin pastes the key; Other
   also asks for a name and a base URL. Then Save.
   - **Where the call goes.** stadeum-ui calls the gateway's admin API
     with the credentials it already holds
     (`ui/src/lib/mothership/admin-credentials.ts`):
     - a built-in provider: `POST /api/providers/{p}/keys {name, value, models: ["*"]}`;
     - Numes or Other: `POST /api/providers {provider, keys, network_config: {base_url}, custom_provider_config: {base_provider_type: "openai"}}`;
     - Maple: the same, with `base_url: http://maple:8080` and
       `allow_private_network: true`.
   - **No restart.** Bifrost's config store holds the change, as the
     e2e already shows.
   - **The key** is never written to stadeum's database or to strut. To
     rotate it, add the new key and delete the old one.
   - **Test** sends one short call through the gateway as the admin, on
     their own delegation. That is the path every call takes, so a green
     Test means people can use the provider.
2. **Models.** For each provider the page shows the models in strut's
   catalog (`GET /llm/models`, with prices and context windows), ticked
   to allow. Any other id can be typed in: the gateway's catalog knows
   689 OpenRouter models. An Other provider's models are typed in, each
   with an optional price per million tokens. A blank price shows as
   "free: no cap applies". One model is starred as the org default.
3. **Save reconciles**, as it does on sign-in today:
   - every person's VK gets `allowed_models` per provider from
     `Org.models`;
   - strut gets `STRUT_MODELS` and `STRUT_DEFAULT_MODEL` through
     `PUT /secrets/:name`;
   - the gateway gets a price row for every allowed model it cannot
     price (work item 5).

**Maple's proxy.** It reads prompts in plaintext, holds no key and needs
no port (`strut deploy/voice/docker-compose.yml:77-98`). stadeum-ui
cannot start a container, because the Docker socket is mounted in `ops`
alone (rule 4).
- **Recommendation: run `maple` in every stack.** Copy the voice demo's
  hardening: pinned `0.4.5`, read-only, `cap_drop: [ALL]`, 256 MB, no
  route in Caddy. Turning Maple on is then a pasted key, as for every
  other provider. With no Maple key in the gateway, nothing calls it.
- **The alternative** is an optional compose profile. That would make
  Maple the one provider that needs a shell (question 2).

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
- **Bifrost's log is one more plaintext copy**, kept for 365 days and
  included in the backup (question 4).
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
- **strut** `src/llm.ts:115`:
  - With `STRUT_MOTHERSHIP_REQUIRED=1`, it asks the hook for every
    provider. "Required" means no direct call.
  - Without it, today's rule stands: Maple and Numes are called
    directly, as on Peel and the voice demo.
- **The gateway** needs a runtime door for price rows. Without a row, a
  Maple call counts as $0 against every cap.

## How strut answers "available"

**The host says.** `STRUT_MODELS` is a JSON list of canonical names,
read from the secret store and then env, like `STRUT_DEFAULT_MODEL`.
- **When it is set**, `GET /llm/models` marks exactly those models
  available, and its `default` is `STRUT_DEFAULT_MODEL`.
- **The list covers every model aieo knows**, each with its price and
  context window, so stadeum's admin page and Jamie's picker read one
  route.
- **When it is unset**, today's key check applies, on Peel and on
  swarms.

**Strut never asks the gateway.**
- It holds no admin credentials.
- A VK's list is per person, but the picker needs one answer.
- The gateway still enforces the list: strut only shows it.

**Known limit.** Both settings sit in strut's deployment secret store,
which anyone signed in can write. Editing them changes what Jamie shows,
not what the gateway lets through, and stadeum's next reconcile puts
them back.

## Work items

In order, one PR each.

| # | Repo | What | Needs |
| --- | --- | --- | --- |
| 1 | stadeum | The Models page, providers and keys: list, add (the five built-ins), Test, delete, all through the gateway's admin API. The provider list becomes what the gateway has, not a fixed five (`types.ts:3`, `constants.ts:23`, `virtual-key.ts:128-139`) | — |
| 2 | strut | `STRUT_MODELS`. `/llm/models` lists every model aieo knows, with price and context. The builder chat's default reads `STRUT_DEFAULT_MODEL` (`createStrut.ts:1218`). Jamie drops a remembered pick that is no longer listed. The gateway's "model not allowed" is explained in plain words | — |
| 3 | stadeum | Allowed models and the org default: `Org.models` and `Org.defaultModel` (a migration). Each VK's `allowed_models` comes from them. Stadeum pushes `STRUT_MODELS` and `STRUT_DEFAULT_MODEL`, and adds `stack/strut/host-config.json` (`model: null` for job, orchestrator and builder) as `STRUT_HOST_CONFIG` | 2 |
| 4 | strut, with aieo inside | Routed OpenAI-compatible providers (Maple, Numes, any name) on the gateway's `/openai/v1`. `llm.ts` asks the hook for every provider under `REQUIRED`. If aieo has not moved yet, the aieo half lands in stakgraph, with a strut bump | the aieo move |
| 5 | gateway | `PUT /_plugin/pricing` (Bearer), kept on the `bifrost` volume, over the config's `model_pricing`. Tests: a custom provider added through `/api/providers` routes `/openai/v1` with `maple/<id>`, reports usage when streaming, and survives a restart with the baked `config.json` | — |
| 6 | stadeum | Numes, Maple and Other on the page. The `maple` service in `stadeum.yml`. Price rows pushed from strut's catalog. `mothership-e2e.sh` gains a fake OpenAI-compatible provider whose calls are billed per person | 3, 4, 5 |

Items 1, 2 and 5 can run at the same time.

## Open questions for Evan

1. **One list for the org, or one per role or person?** The VK is
   already per person, so per-person lists cost nothing new later. v1
   has one list.
2. **Maple's proxy in every stack (recommended), or behind a compose
   profile?**
3. **Drop the five provider-key rows from `.env` once the page ships?**
   Two ways in means two answers to "which key is live". Recommended:
   yes. Scripted installs call the gateway's API.
4. **Bifrost's log keeps every prompt for 365 days.** Keep it, for
   debugging and the spend pages? Or turn content logging off, which
   suits Maple's promise better and shrinks backups?
5. **Does any Hive swarm run strut with `STRUT_MOTHERSHIP_REQUIRED=1`
   and call Maple or Numes directly?** Item 4 would send those calls to
   a gateway with no route for them.
6. **Numes' free models:** allowed for everyone by default, since they
   cost nothing, or off until an admin ticks them?
