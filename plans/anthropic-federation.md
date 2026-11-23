# Anthropic without a key: the box signs for itself

> **Status (2026-11-23): built for a box, differently; fleet's part (§5)
> still proposed.** Bifrost v2.5 learned to federate Anthropic itself: a
> key with `anthropic_key_config.workload_identity` reads an identity token
> from a file, exchanges it, keeps the hour's token and renews it. So the
> box's *gateway* is the issuer, not stadeum-ui (stakwork/mothership,
> `wrapper/identity.go`, `BIFROST_IDENTITY_ISSUER`): it holds the signing
> key in its volume, publishes the key set at
> `mothership.$HOST/.well-known/`, and rewrites the token file every 30 s.
> §1–§3 below are replaced: stadeum-ui signs nothing and renews nothing; it
> writes the federated key where a pasted one goes. §4 is built
> (`docs/models.md`, "Anthropic without a key"), with Bifrost's names
> (`federation_rule_id`) and the service account's ID, which Bifrost
> requires. §6.1 is answered: Bifrost sends the minted token as a bearer.
> The `sub` is `mothership`, not `stadeum`.
>
> Proposed 2026-11-21, read against stadeum `main` @4c2da09,
> stakwork/stadeum-fleet `main` @aad11efc, the gateway's bifrost `core`
> v1.10.1, and Anthropic's Workload Identity Federation docs
> (platform.claude.com/docs/en/manage-claude/: `authentication`,
> `workload-identity-federation`, `wif-reference`, `wif-admin-api`,
> `wif-providers/aws`). Evan agreed the renewal (§3) the same day.

## Problem

A box calls Anthropic with a long-lived `sk-ant-…` key. An admin pastes it
on the Models page, or the box's host gives it in `STADEUM_MODEL_PROVIDERS`
(docs/models.md, "Providers given at install"). It lives in the gateway,
and a given one in `.env` too, so in every backup.

Fleet gives every box one. Staff make each key by hand in Anthropic's
console and add it to fleet's key pool; a claim takes one, and destroying
the box disables it (stadeum-fleet `PLAN.md` §7). It is the one per-box
step fleet cannot automate: Anthropic's Admin API reads and disables keys,
but does not make them.

Anthropic now has **Workload Identity Federation**. A workload presents a
JWT signed by an issuer the organization trusts; `POST /v1/oauth/token`
trades it for an `sk-ant-oat01-…` token that acts as a service account,
for a minute to a day. The issuer, the service account and the rule that
joins them can all be made through the Admin API.

## Recommendation

**Each box is its own OIDC issuer.** stadeum-ui signs a short JWT for the
box, trades it for an Anthropic token, and writes the token into the
gateway's Anthropic slot, where a pasted key sits today, every 15 minutes.
Fleet makes each box's issuer, service account and rule at claim and
archives them at destroy, and its key pool goes. Pasting a key stays, for
an admin who prefers it.

Why the box's own issuer, not its cloud's identity (AWS STS
`GetWebIdentityToken`, Google's metadata server, Azure's IMDS):

- It works the same on every cloud and on a laptop (rule 5). A cloud's
  tokens would put that cloud's code in stadeum.
- On fleet, every box in a cell runs as one role (`aws/base.yml`,
  `BoxRole`), so an STS token's `sub` is the same for all of them. Telling
  boxes apart would rest on the instance ID inside the token's
  `principal_id`.

## 1. The box's signing key

- **A P-256 key (ES256)**, made by stadeum-ui when federation is first
  set, kept in its database encrypted under `STADEUM_ENCRYPTION_KEY`.
  Signed with `jose`, which Auth.js already brings.
- **Not the org key.** That one is secp256k1
  (`stack/bootstrap/org-identity.mjs:69`); Anthropic accepts only RSA,
  RSA-PSS and ECDSA on P-256, P-384 and P-521.
- **Who can read it:** stadeum-ui alone. It is in the backup
  (`stadeum.db`). A leaked backup lets its holder mint tokens until the
  rule is archived or the key replaced: as a leaked key does today, but
  nothing of Anthropic's is in `.env`.

## 2. What the box publishes

- **The issuer** is stadeum-ui's origin, from `AUTH_URL`: for example
  `https://acme.stakwork.ai`.
- stadeum-ui serves `/.well-known/openid-configuration` (`issuer`,
  `jwks_uri`) and the key set it names: the public key alone, with its
  `kid`. Both are public, with no sign-in. Caddy already sends `$HOST` to
  stadeum-ui.
- **Discovery.** Anthropic fetches the key set itself and caches it,
  picking up a change within a minute. It needs https on 443 and a public DNS
  name with public addresses, which every box with a domain has.
- **A box Anthropic can't reach** (a laptop on `*.localhost`, a private
  network) is registered with its key set pasted in (`inline`). The Models
  page shows it. An inline key set does not follow a new key: replacing
  the key means pasting again.
- **A new key** is published at least 15 minutes before it signs, and the
  old one kept until its tokens expire (Anthropic's guidance). Nothing
  replaces the key at first; a button can come if it is ever needed.

## 3. The exchange, and the gateway

- **Every 15 minutes**, and a minute after start, stadeum-ui signs a JWT:
  `iss` the issuer, `sub` `stadeum`, `aud` `https://api.anthropic.com`,
  `iat` now, `exp` an hour on, a fresh `jti` (Anthropic accepts each `jti`
  once), and the key's `kid` in the header.
- It posts it to `POST /v1/oauth/token`: `grant_type`
  `urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion`,
  `federation_rule_id`, `organization_id`, and `workspace_id` when the
  rule is enabled in more than one workspace. The token lasts the lesser
  of the rule's `token_lifetime_seconds` (3600) and twice the JWT's
  remaining life: an hour.
- **The token goes into the gateway** by the write the Models page and
  `applyGivenProviders` already use (`writeKey`,
  `ui/src/lib/models/providers.ts`). Bifrost uses it from the next
  request, with no restart.
- **Its own timer**, beside upkeep's six hours
  (`ui/src/instrumentation-node.ts`), and the same `STADEUM_RENEWAL=0` to
  turn it off.
- **A renewal that fails** is logged and tried again at the next tick; the
  token in hand still has 45 minutes or more. The Models page shows the
  last renewal, when the token expires, and the last error.
- **What an agent sees: nothing.** Strut's agents and a pod's apps call
  the gateway with a gateway key (a person's virtual key, or a grant's).
  The gateway attaches whichever token it holds to each request. A
  two-hour run is many requests, each with the token current when it is
  sent. The old token stays good until its own expiry, so a renewal
  leaves no gap.
- **What stops the models:** stadeum-ui not renewing for 45 minutes. Today
  the gateway goes on with its static key while stadeum-ui is down.
  **Decided (Evan, 2026-11-21):** accept it. stadeum-ui renews every 15
  minutes, with hour-long tokens. Renewal moves into the gateway (Go in
  stakgraph's gateway, which would then hold the signing key) only if
  stadeum-ui outages show up. Longer tokens are the other lever: a rule
  allows a day, but an issuer accepts JWTs of an hour unless raised in
  Anthropic's console, and a leaked token then lives as long.

## 4. The setting

- **Given by the host.** A `STADEUM_MODEL_PROVIDERS` entry takes
  `federation` in place of `key` (`ui/src/lib/models/given.ts`):

  ```
  STADEUM_MODEL_PROVIDERS='[{"provider":"anthropic","federation":{"organization_id":"…","rule_id":"fdrl_…","workspace_id":"wrkspc_…"}}]'
  ```

  `workspace_id` is optional when the rule is enabled in one workspace.
  None of the three is a secret. The Models page shows it as given, with
  Test alone, as it does a given key.
- **Set by an admin.** On the Models page, Anthropic offers "Connect
  without a key" beside the key. It shows the issuer URL, the subject and
  the audience to enter in Anthropic's console (Workload identity, Connect
  workload, Custom OIDC; scope `workspace:inference`), and the key set for
  a box Anthropic can't reach. The admin pastes back the organization,
  rule and workspace IDs; Test runs an exchange. They are kept with the
  org's settings.
- **Anthropic alone**, for now.

## 5. Fleet

Fleet is the first user. Its part goes in stadeum-fleet's `PLAN.md` §7
once this is agreed; it is here so the two are read together.

- **Fleet's own access.** The endpoints for service accounts, issuers and
  rules take only an `org:admin` OAuth token and refuse Admin API keys,
  so `FLEET_ANTHROPIC_ADMIN_KEY` goes. Fleet federates as its instance's
  role (`aws/fleet.yml`, `Role`): AWS STS `GetWebIdentityToken`, audience
  `https://api.anthropic.com`. By hand, once per account (fleet's rule 1
  allows it): turn on IAM's outbound web identity federation, give
  fleet's role `sts:GetWebIdentityToken`, and make the `org:admin` rule
  in Anthropic's console, matched to fleet's exact role ARN, targeting a
  service account with the admin role. Only the console can make an
  `org:admin` rule.
- **What that token reaches.** The whole organization: no narrower scope
  exists, and workspaces don't bound it. Members, invites, workspaces,
  every API key, every rule and issuer. Two limits hold for a federated
  token: it makes and changes only `workspace:inference` and
  `workspace:developer` rules, and it can't make a service account an
  admin. So a compromised role can't leave itself lasting admin access.
  Fleet's Admin API key already reaches members, invites, workspaces and
  API keys; federation adds service accounts and rules, and drops a
  long-lived secret.
- **Its organization. Decided (Evan, 2026-11-22): the existing one,** with
  fleet's boxes in a workspace of their own, for a spend limit and their
  own usage. An organization of fleet's own stays an option: it would keep
  fleet's `org:admin` from reaching anything else of Stakwork's, and the
  boxes' rate limits apart from ours. It costs its own billing and logins,
  and a rate-limit tier that starts low (tiers are per organization).
  Take it if the existing organization comes to hold what a fleet bug
  shouldn't touch.
- **At claim**, the `models` step (`app/src/lib/jobs.ts`) makes, each
  named `box-<id>`: a service account (`developer`, added to the boxes'
  workspace: a service account acts only in workspaces it belongs to); an
  issuer, the box's gateway at `https://mothership.<name>.<FLEET_DOMAIN>`
  (fleet already makes that record), by discovery; and a rule joining
  them (`subject_prefix` `mothership`, audience
  `https://api.anthropic.com`, the boxes' workspace, scope
  `workspace:inference`, 3600 seconds). The answers give the box
  `federation` with the four IDs (`organization_id`,
  `federation_rule_id`, `service_account_id`, `workspace_id`;
  `docs/models.md`). No model secret passes through Parameter Store.
- **Only to a stadeum that takes it.** A stadeum before
  stakwork/stadeum#88 leaves a `federation` entry out ("it has no key"),
  and the box gets no Anthropic. Fleet gives `federation` once `stable`
  carries #88.
- **At destroy**, the `models` step archives the rule, then the issuer and
  the service account (archiving either while a live rule names it is a
  400). The box's last token stops at its expiry, within the hour.
- **Deleted:** the key pool (`app/src/lib/keys.ts`, the Keys page, the
  `/stadeum-fleet/keys/<id>` SecureStrings, `FLEET_KEYS_LOW`), a claim's
  wait of up to three hours for a key, and the keys a destroyed box left
  for staff to disable. Every per-box step is then automated, models
  included.
- **Fleet's rule 3 holds:** the box's gateway trades its identity token
  with Anthropic, never with fleet, and its signing key never leaves the
  box.
- **Spend per box** is a gate (§6, 6). We pay for the models, and fleet's
  only view of one box's spend today is Anthropic's usage report grouped
  by key (fleet's `PLAN.md`, Q7), which goes with the key pool. The
  federation pages say only that a token's usage is attributed to its
  workspace, as an API key's is. If usage and cost group by service
  account, each box keeps its own, as above. If they don't, a service
  account per box buys nothing: the boxes share one, a claim makes and a
  destroy archives an issuer and a rule alone, and fleet needs another
  view of a box's spend before the key pool goes. A cap per box stays
  what it is today: none.

## 6. To check before building

1. **The header.** Bifrost sends the Anthropic key only as `x-api-key`
   (`core` v1.10.1, `providers/anthropic/anthropic.go`,
   `anthropicRequestHeaders` and each request path). Anthropic's docs send
   these tokens as `Authorization: Bearer`. If `x-api-key` is refused, the
   gateway must send Bearer for an `sk-ant-oat01-` key: a small change in
   stakgraph's gateway, or upstream.
2. **A stream that outlives its token.** A request is authenticated when
   it starts; one still streaming when its token expires should not be
   cut off.
3. **Limits.** The docs give no limit on issuers, rules or service
   accounts per organization. Fleet is built for 200 boxes a day: ask
   Anthropic.
4. **Revocation.** Whether archiving a rule stops tokens already minted,
   or they run to their expiry. An hour bounds it either way.
5. **When Anthropic first fetches a key set.** If making an issuer by
   discovery fetches it at once, fleet makes the issuer after the box is
   up, and the IDs can't ride in the claim's answers, which a box reads
   once. The docs don't say. They hint at the exchange: verifying an
   issuer is an optional step in the console, and a failed fetch is among
   the exchange's errors.
6. **Spend by box.** Whether usage and cost analytics group by service
   account (the `actor` dimension). It decides whether a box has a
   service account of its own, and whether fleet still sees one box's
   spend (§5, Spend per box).

1 and 2 take one rule on a test box and a few curls: the exchange, a
message with the token in each header, a long stream across a renewal.

3, 5 and 6 decide the shape of fleet's part, so they are answered before
§5 goes into fleet's `PLAN.md`, not while it is built. 5 and 6 take a few
more curls: an issuer made for a name that doesn't answer yet; two
service accounts with a rule each, a message as each, and the usage
report read by service account. 3 is a question to Anthropic.

## 7. What changes elsewhere, when built

- **AGENTS.md rule 4:** the box's federation signing key, in stadeum-ui's
  database, encrypted, read by stadeum-ui alone. **Rule 6:** the database
  holds it with the org's settings.
- **docs/models.md**, "Providers given at install": the `federation`
  entry; and the Models page's "Connect without a key".
- **stadeum-fleet:** `PLAN.md` §7 and Q7 (a box's model spend),
  `README.md` ("Models"), `DEPLOY.md` (the one-time setup in place of the
  Admin API key).

## Order

Each step its own PR:

1. The checks in §6, all but 4, by hand. 1 is answered (the status,
   above). 3, 5 and 6 are open, and step 4 waits for them.
2. stadeum: the key, the two `/.well-known` routes, the renewal, and
   `federation` in `STADEUM_MODEL_PROVIDERS`. The fake stack answers
   `/v1/oauth/token`, and a test checks that a renewed token reaches the
   gateway.
3. stadeum: "Connect without a key" on the Models page.
4. stadeum-fleet, once §6's 3, 5 and 6 are answered: its own federation,
   the claim's and destroy's `models` steps, the key pool deleted.
