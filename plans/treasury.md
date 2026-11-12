# The treasury: a Lightning wallet for strut on every box

> **Status (2026-11-12): built** (stakwork/stadeum#34): the `treasury`
> service, its tokens, its backup and restore, and the image's `stable`
> channel (stakwork/sphinx#430, `scripts/promote.sh daemon`). Kept for its
> decisions, the risk accepted (§2), and Earnings in the admin pages (§6),
> built since (strut's app, stakwork/strut#650, framed by stadeum's
> `/earnings`). Read against stadeum `main` @64de7a6, strut `main` @b0863473,
> stakwork/sphinx `master` @48d7d87b and sphinx-swarm `master` @8997ceb3,
> whose treasury (stakwork/sphinx-swarm#787) this copies.

## Problem

Strut sells paid public runs over Lightning (strut `plans/paid-runs.md`,
`specs/LIGHTNING.md`): an L402 credit token bought with an invoice, charged
by each run. It takes payments in through a wallet, and pays out of it when
an admin withdraws (strut `specs/API.md` §18, §19). Strut can use a Sphinx
daemon or an NWC connection; with neither, nothing on the box can be sold.

Today a stadeum box runs no wallet. An admin can bring an NWC connection
through strut's own wallet form, but a box should be able to sell from its
first boot, with nothing to set up, as a swarm can.

## Decided

| Question | Decision |
| --- | --- |
| The wallet | **agreed.** A `treasury` service: the Sphinx daemon (`ghcr.io/stakwork/sphinx-daemon`, stakwork/sphinx `wasm/daemon`) on an account of its own, as in sphinx-swarm. Internal: no port, no route in the Caddyfile. It connects out to its LSP only (the image's default, `broker.v2.sphinx.chat`), as voice connects out to LiveKit (rule 5). |
| The pay token in strut | **agreed: the risk is accepted.** Strut gets the receive token and the pay token, so it can sell and an admin can withdraw from strut's Earnings tab. Strut's agents run shell commands in its container (rule 4), so an agent, or a prompt that steers one, can read the pay token and pay out the wallet. See "The risk we accepted". |
| The volume | **agreed.** `treasury` (`/data`) is the money: the account's seed is made there on the first start, beside `wallet.jsonl`. It is in the nightly backup, stopped for the snapshot like Neo4j (`stadeum.ops.backup: stop`), and `scripts/backup-restore-e2e.sh` proves it comes back. |
| One account, one container | **agreed.** A second daemon on the same seed knocks the first off the broker. A restore onto a new box while the old one still runs does exactly that, so the restore says so, in `scripts/install.sh` and on the Backups page's restore kit. |
| The tokens | **agreed.** `scripts/init-env.sh` generates `DAEMON_ADMIN_TOKEN`, `DAEMON_RECEIVE_TOKEN` and `DAEMON_PAY_TOKEN`, three different values (the daemon and strut each refuse two equal ones). The admin token goes to the treasury alone; no service holds it. |
| The channel | **agreed.** `sphinx-daemon:${TREASURY_TAG:-stable}`. `stable` is moved by stakwork/sphinx's `promote-daemon.yml`, run with `scripts/promote.sh daemon`, never `latest` (rule 7). |
| Its update group | **built.** `stadeum.ops.update: strut`, as voice: strut's payer and the daemon's wallet routes are one contract, so they move in one drain, one health check, one rollback. A recreate keeps the volume. |
| Stadeum's pages | **agreed (2026-11-12).** None in this work. Later, Earnings among the org's admin pages, as a framed strut app (§6, since built). |
| Existing boxes | **agreed (2026-11-12).** There is one box; its admin runs the installer (`scripts/install.sh`) again once after the release, which runs the release's `init-env.sh`. Ops does not write `.env`. |
| The alias | **agreed (2026-11-12).** `treasury` on every box. |
| The LSP | **agreed (2026-11-12).** The image's default broker; no `SPHINX_LSP` setting until a box needs one (rule 10). |

## 1. The service

Built as `stack/stadeum.yml`'s `treasury` service and volume, and strut's
`LIGHTNING_DAEMON_*`; `docs/stack-spec.md` ("treasury") describes it. Two
choices made there:

- **Without its tokens it waits** (`sleep infinity`, as voice does without
  LiveKit's keys). The daemon would otherwise make its own tokens, a seed,
  and an account on the broker that nothing uses. Strut gets its three
  `LIGHTNING_*` only when `.env` has all three tokens, so a box that has
  not run the installer again since the treasury came has no wallet, and
  every other service is as before.
- **No change to ops.** It mounts the volume at `/volumes/treasury` with
  the others and stops the service by its label, so the volume is in the
  snapshot with no change to `ops/src/backup.ts`.

## 2. The risk we accepted

Rule 4 keeps the org key and the Docker socket out of strut's container
because its agents run shell commands there. The pay token goes in anyway,
by decision. What it means:

- **What can happen.** Anything that runs a shell in strut's container (an
  agent's `exec` step, a workflow an admin installed, a prompt injection
  that steers either) can read the pay token and `POST /pay` to the
  treasury. Strut hides `LIGHTNING_*` from steps' secrets and empties its
  `process.env` after boot, so a child process does not inherit it, but
  the environment the process started with is still readable to its own
  user (`/proc/<pid>/environ`). With it, a shell can send the wallet's
  whole balance anywhere. The receive token alone could only make
  invoices and read the balance.
- **Why we accept it.** The wallet holds what the box's paid runs earned:
  small sums, swept out by an admin. Withdrawing from strut's Earnings tab
  is the feature, and the alternatives cost more than the risk: a
  withdrawal route in stadeum-ui that holds the pay token makes stadeum
  know what a payment is (rule 1), and a receive-only strut makes every
  withdrawal an operator's job on the box.
- **What bounds it.** The treasury holds only what was paid in; the org's
  money is never in it. The admin token, which can post and join tribes as
  the account, is in no container but the treasury's. The seed is never in
  strut's container: a stolen token can spend the balance once, but cannot
  take the account.
- **What would change it.** If boxes start holding real balances (a
  treasury fed by Add sats, or sums worth stealing), move the pay token out
  of strut: strut gains a "withdrawal asked for" state an admin confirms,
  and the pay is made by whoever holds the token. That is a strut change
  first.

The stack file's comment on `LIGHTNING_DAEMON_PAY_TOKEN`, `AGENTS.md`'s
rule 4 and `docs/stack-spec.md` each say this in a line, pointing here.

## 3. Backups and restores

- **What is backed up.** The whole volume: the account's seed, in
  sphinx-chat's layout, and `wallet.jsonl`. `.env` carries the three
  tokens, as it carries every other secret. Lose both the volume and every
  snapshot and the sats are gone; nothing else holds them.
- **Stopped for the snapshot.** `wallet.jsonl` is appended as payments
  settle; stopping the treasury (it stops cleanly on SIGTERM) for the few
  minutes strut is already drained keeps the file whole. Strut sells
  nothing while drained, so the only cost is an invoice made before the
  drain and paid during the stop: the LSP fails it back and the payer pays
  again once it is up, within the invoice's expiry.
- **The proof.** `scripts/backup-restore-e2e.sh` starts the treasury, lets
  it make its account, backs up, wipes the volume, restores, and checks the
  account's files come back byte for byte and the daemon connects again
  (`GET /health`). Not the balance: the e2e has no sats.
- **Restoring onto a new box.** The old box must be stopped first, or the
  two fight over the account on the broker. `scripts/install.sh`'s restore
  already refuses a running stack on the box it runs on; it also says,
  before it starts anything, that the old box must be down. The restore kit
  on the Backups page says the same.

## 4. Updates and releases

- `scripts/promote.sh daemon [commit]` moves `sphinx-daemon:stable` to
  stakwork/sphinx master's newest image (built only when `wasm/daemon`,
  `wasm/chat` or what they build from changes). Done here, with
  `promote-daemon.yml` in stakwork/sphinx.
- In strut's update group, a box moves the treasury in its nightly window
  with strut and voice, and rolls all three back together.
- The first release that has the treasury adds the service and the volume.
  Ops applies it; the box has no tokens until an admin runs the installer
  (`scripts/install.sh`) again, so until then the treasury waits and strut
  has no wallet (§1).

## 5. What changes, by file

| File | Change |
| --- | --- |
| `stack/stadeum.yml` | the `treasury` service and volume; strut's three `LIGHTNING_*` |
| `.env.example` | the three tokens and `TREASURY_TAG`, each with a comment |
| `scripts/init-env.sh` | `set_if_empty` for the three tokens |
| `scripts/install.sh` | the restore's warning that the old box must be down |
| `scripts/backup-restore-e2e.sh` | the treasury's account survives a restore |
| `scripts/promote.sh` | `daemon` (done) |
| `AGENTS.md` | the architecture row, rule 4's line on the pay token, rule 8's list, the roadmap |
| `docs/stack-spec.md` | the service, its volume, its channel |

| `ui/` | the restore kit's line that the old box must be down; nothing else |

No change to `ops/src/`.

## 6. Open

- **Earnings in the org's admin pages** (**built**, 2026-11-12: strut's
  `strut/earnings`, an admin-only app, stakwork/strut#650; stadeum's
  `/earnings` frames it for an admin, and the Organisation settings list
  it when strut does). People never see strut's own UI, so an admin needs the balance,
  earnings, Add sats and Withdraw among stadeum's admin pages (beside
  Spending, Models, Backups). Rule 2 still holds: the page is a strut app
  (strut's Earnings, shipped as an app and listed by `GET /apps`) framed
  there and signed in as the admin, not a page stadeum draws from
  `/earnings`, which would make stadeum know what a payment is (rule 1).
  First step: a strut change that ships Earnings as an app (done).
