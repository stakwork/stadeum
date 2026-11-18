# Pods: a machine of its own for every coding job, on Lambda MicroVMs

> **Status (2026-11-18): proposed. Nothing is built.** From one design
> conversation with the owner on 2026-11-17, revised twice on 2026-11-18.
> The first revision matched strut's revised `plans/followed-repos.md`: a
> box follows pods through a strut subscription, not a `STRUT_REPOS` list
> (stakwork/stadeum#52). The second takes the cloud keys out of strut: pods
> run through a multi-tenant pods service that holds them, and strut holds
> a token for its own tenant (owner, 2026-11-18). In "Decided", **agreed**
> rows are the owner's; **proposed** rows are mine and stand until the
> owner rules. This plan replaces strut's `plans/pods.md` (2026-11-10),
> which put pods on an always-on pod box per org. It keeps that plan's
> agreed parts: strut's agent works in the pod through an exec service,
> and what a job learns about running the app is kept in strut (strut
> `plans/pods.md` §1–§3). That plan's manager API (§7) and signed links
> (§8) are where the service's API starts. Read against stadeum `main`
> @0b0196e (@bbbc85c and @c0e08ab for the revisions), strut `main`
> @e6b5539c (@157b3f80 for the second revision, with `git+` subscriptions
> built in stakwork/strut#739), strut's revised `plans/followed-repos.md`
> (stakwork/strut#738: `git+` subscriptions, a package that lacks a secret
> kept out, and tools a package gives the job agent), stakgraph `main`
> @ee46d0db (the lab's `pod/*` steps and its `Pod`, `Pod Config` and
> `Code Change` pages) and staklink `main` @843c13f.

## Problem

A coding job sometimes needs the app running: to build it, to test it
against a real database, or to let a person click through a change.
Today such a job gets a pod from Hive's pool, a Kubernetes service
Stakwork runs. A Stadeum box can't use it: it stands alone (rule 9).

Strut's 11-10 plan answered with a pod box per org: one big machine
beside the Stadeum box, running a Firecracker VM per pod. The owner
turned that down on 2026-11-17:
- A big always-on machine is expensive.
- Every org wants it at the same time (Pacific mornings), so it doesn't
  scale.
- Containers on a shared machine aren't private, even with sysbox.

What is wanted instead:
- **Burstable compute that costs nothing while nobody uses it.**
- VM isolation.
- A wake from a hibernated state, with installs already done.
- Run by Stakwork for a small number of close clients, and by customers
  in their own AWS beside their Stadeum box.
- Delivered as a strut package, not by embedding strut: *"Stadeum should
  add functionality to strut as well (pods). But not 'embedded'.. but via a
  package."*
- No cloud keys in strut, where agents run shell commands (2026-11-18).

## Decided

| Question | Decision |
| --- | --- |
| What a pod runs on | **proposed**, to meet the owner's requirements (**agreed** 2026-11-17: nothing spent while idle, VM isolation, the box's own AWS). AWS Lambda MicroVMs: AWS's Firecracker sold by API. Compute is billed per second while a MicroVM runs. A suspended one costs only snapshot storage, and a terminated one costs nothing. There's no machine per box: the one server is the pods service (§2). |
| Who holds the cloud keys | **agreed (2026-11-18: *"we'll run a pods proxy that has an api, and is multi-tenant: the strut package tools hit that api. The AWS or other cloud keys are in that service. self-hosters would run the same service as a container in Stadeum."* And: *"Not sure if it makes sense to put AWS secrets directly on Stadeum boxes?"*)** A pods service holds them, and the package's steps call its API. Stakwork runs one for every box it hosts; a self-hosted box runs the same service as a container. Strut holds only the service's URL and a token for its own tenant, `PODS_URL` and `PODS_TOKEN` (§2). |
| Whose AWS account | **agreed.** The account of whoever runs the pods service: Stakwork's, for the boxes it hosts; the customer's own, beside a self-hosted box. Hosted boxes share Stakwork's account, each a tenant of its service (§2.2). |
| Rule 5 (any cloud) | **proposed.** It holds for the box. Pods are an optional package, and the cloud sits behind the service's API: another provider is a change to the service, not to the package or the box. A box with no pods service has no pods, and nothing else on it changes. |
| How pods reach strut | **agreed (2026-11-18: "git+ refs in subscriptions is the way").** A strut package, `stadeum/pods`, that the box follows through a strut subscription to a git branch: `PUT /packages/subscriptions/pods { ref: "git+https://github.com/stakwork/pods@stable#package" }` (strut `plans/followed-repos.md` §1). It's strut content, not stadeum code (rule 1). Stadeum's part is the subscription and its sync in the upkeep window (§10), and on a self-hosted box the service's container. The repository is proposed (next row). |
| Where the service and the package live | **proposed.** A new repository, `stakwork/pods`: the service (`service/`, its image `ghcr.io/stakwork/pods`), the package (`package/`) and the AWS template (`aws/pods.yml`). Public, so the subscription needs no token and a self-hoster can read what they run. Rule 1 keeps the box and the product apart: Stadeum runs the service only as an optional container, as it runs the treasury's image. Not created yet. |
| The branch boxes follow | **proposed.** `stable` of `stakwork/pods`, moved to `main`'s head with the image's `stable` tag by that repository's promote (rule 7: pinned to a channel, never latest). `scripts/promote.sh pods` runs it. A rollback is `stable` moved back. Jamie's PRs go to `main`. |
| Who subscribes a box | **proposed.** ops, with the deployment key, at first boot. The package list rides Stadeum's release, not `.env` (§10). |
| When the package moves | **agreed (2026-11-18: "the same schedule as updating images").** Each night in the upkeep window, after strut's image. Strut's own poll is off, and ops syncs the subscription (§10). The route is proposed. |
| A box without the pods secrets | **agreed (2026-11-18: "disable the package completely (tools and concepts)").** Nothing of pods is installed until `PODS_URL` and `PODS_TOKEN` are set: no tools, no Concept pages (§10). |
| Which boxes first | **agreed (2026-11-18).** The boxes Stakwork hosts. Stakwork makes each a tenant of its service and sets its token at provisioning. Self-hosted boxes come later (§10). |
| Where pods are developed | **proposed.** On a box that opens `stakwork/pods` on `main` instead of subscribing (§10). |
| npm dependencies in its steps | **agreed (2026-11-17: "Vendor for now").** A step imports `strut` and its own helper files. The steps need nothing more: each is an HTTP call to the service through `ctx.services.http`. Nothing in strut signs an AWS request. |
| Where the agent's loop runs | **agreed (strut `plans/pods.md`, 2026-11-10).** In strut. Only its tools run in the pod, through an exec service. A pod holds no strut credential. |
| The exec service | **settled (same plan).** staklink's, with the MicroVM hooks added (§7). It's in every workspace image already: `FROM ghcr.io/stakwork/staklink-js`. |
| A pod's life | **proposed.** A pod is the job's until the job lets it go. A MicroVM lives at most 8 hours, suspended time included, and AWS won't raise that. So a pod is a chain of MicroVMs, and the service saves its changes between one and the next (§5). |
| A workspace's template | **proposed.** One MicroVM image per workspace, built from its Dockerfile with its repositories inside. The services are started during the build and snapshotted running (§4). |
| A workspace's devcontainer files | **proposed.** The main repository's `.devcontainer/` (`Dockerfile`, `docker-compose.yml`, `pm2.config.js`), or the defaults when it has none. A fix reaches every pod through a PR to the repository. This replaces Hive's per-workspace store (`Pod Config`). |
| Saves in a shared account | **proposed.** A MicroVM gets signed URLs for its own pod's saves in its run payload, and no AWS role. One execution role for every pod would let a repository's code read every tenant's saves (§5). |
| Calls into a pod | **proposed.** All go through the service at first, which adds the MicroVM's token and the pod's password. Later the service can hand strut a short-lived token for one pod, so exec goes straight to the MicroVM (§2.5). |
| The token in strut | **proposed: the risk is accepted**, as the treasury's pay token is (rule 4). `PODS_TOKEN` reaches only the box's own pods, and Stakwork replaces it per box (§11). |
| Backups | **proposed.** Pods aren't in the box's backup (rule 8). A pod holds work in progress. Pushed work is in GitHub, what the agent learned is in strut's graph (backed up), and images are rebuilt from the repositories. A self-hosted box's `pods` volume, the service's database, is in the backup like every volume. |
| A person's browser opening a pod | **proposed.** The service turns a signed link into the MicroVM's header, on a name per pod and port. Strut needs no proxy route (§8). |

## 1. What a Lambda MicroVM gives

From AWS's developer guide (`microvms-how-it-works`, `-images`,
`-images-snapshots`, `-launching`, `-networking`, and the quotas page),
read 2026-11-17. Numbers marked *third-party* come from one early test and
need the trial to confirm them (§14 step 1).

| What | Fact |
| --- | --- |
| Size | Up to 16 vCPUs, 32 GB of memory and 32 GB of disk; x86_64 or ARM64 |
| Lifespan | `maximumDurationInSeconds` is at most 28,800 (8 hours), counting running and suspended time, and can't be raised. TERMINATED is final |
| Idle | `idlePolicy`: `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `autoResumeEnabled`. Only traffic through the endpoint counts as activity, not outbound traffic or CPU |
| Wake | With `autoResumeEnabled`, a request to a suspended MicroVM resumes it and waits. AWS says "sub-second to single-digit seconds"; 1.9 s measured (*third-party*) |
| The endpoint | HTTPS per MicroVM, any port: `X-aws-proxy-port`, or for WebSocket the subprotocol `lambda-microvms.port.{N}`. HTTP/1.1, HTTP/2, WebSocket, gRPC, SSE |
| Its auth | A JWE token from `CreateMicrovmAuthToken` (ports and expiry), in the `X-aws-proxy-auth` header or, for WebSocket, the subprotocol `lambda-microvms.authentication.<token>`. No unauthenticated access, and no cookie or query parameter |
| Limits per MicroVM | 40 requests/s at 4 vCPU / 8 GB (160 at 16 / 32); 150 connections plus 50 per extra vCPU, up to 600; inbound 2 MB/s per vCPU |
| Outbound | The internet, by default. UDP is blocked, so Docker containers need Lambda's resolver: `--dns 169.254.169.253` (*third-party*) |
| Inside | Amazon Linux 2023. The app runs as a container in it. `additionalOsCapabilities: ["ALL"]` allows mounts, network namespaces and eBPF. Docker runs inside (*third-party*: dockerd needs `--containerd=/run/containerd/containerd.sock`) |
| An image | `create-microvm-image`: a zip in S3 with a Dockerfile and files, a base image, and a build role. Lambda runs the Dockerfile, starts its ENTRYPOINT or CMD, waits for the `/ready` hook to answer 200, and snapshots memory (running processes, daemons included) and the root filesystem. `/validate` then runs on a MicroVM made from the image. Up to 50 environment variables are set at build |
| Hooks | Lambda POSTs to `/aws/lambda-microvms/runtime/v1/<hook>` on a port the image names. Build: `ready`, `validate`. Run: `run` (a payload of up to 16 KB from `run-microvm --run-hook-payload`), `resume`, `suspend`, `terminate`. A `run` that fails or times out (`runTimeoutInSeconds`) may terminate the MicroVM |
| Runtime AWS access | `run-microvm --execution-role-arn`: the code inside reads and writes AWS with that role |
| Quotas, per account and region | 800 GB of memory across running and suspended MicroVMs (2,048 GB in the main regions), adjustable. `RunMicrovm` and `ResumeMicrovm` 5/s, `CreateMicrovmAuthToken` 50/s, 5 image builds at once (10 in some regions) |
| Price (ARM, US East) | About $0.10 per vCPU-hour and $0.013 per GB-hour running, so ≈ $0.25 an hour for 2 vCPU / 4 GB. Snapshots $0.08 per GB-month; $0.0038 per GB written at a suspend and $0.00155 per GB read at a resume. Images are kept at least a week. These rates came from a summary of the pricing page, so check them before quoting |

## 2. The pods service

One program between strut and the cloud, `ghcr.io/stakwork/pods`. It
holds the cloud keys, and it's the only thing that calls AWS. Strut holds
its URL and a token for one tenant: `PODS_URL` and `PODS_TOKEN`.

- **Hosted.** Stakwork runs one, in its AWS account, for every box it
  hosts. Each box is a tenant.
- **Self-hosted (later).** The box runs the same image as a container,
  `pods`, beside strut, with its own account's keys (§9). It has one
  tenant: the box.

Why a service, and not the keys in strut:
- Strut is where agents run shell commands, so any secret in strut can be
  read by one (rule 4). A cloud key there was the risk the earlier
  revision accepted. It goes away.
- It's the treasury's pattern: the container keeps the dangerous
  credential, and strut holds a narrow token that reaches only its own
  tenant's pods, revocable per box.
- Hosted boxes share Stakwork's AWS account. Keys in each strut would need
  IAM scoped per tenant. The service enforces tenancy in one place, and
  meters each tenant for billing.
- The cloud sits behind an API, so another provider is the service's
  change (rule 5).
- It answers how a browser opens a pod (§8): the service is in the path,
  so strut needs no proxy route.
- The package gets thin: HTTP calls with `PODS_URL` and `PODS_TOKEN`.

### 2.1 Its API

It starts from the manager's API in strut's 11-10 plan (strut
`plans/pods.md` §7). Claim and drop keep Hive's pool-manager paths, and
every call takes `x-api-token`, as Hive's do. A call acts only on its
token's tenant: another tenant's pod or workspace answers 404.

| Call | Path | Does |
| --- | --- | --- |
| Claim | `POST /api/pool-manager/claim-pod/:workspace?job=` | The job's pod. The first claim launches a MicroVM from the workspace's current image. Later claims return the same pod, rolled over first if its MicroVM is older than 7 hours or gone (§5). Answers `{ podId, startedAt }` |
| Drop | `POST /api/pool-manager/drop-pod/:workspace?podId=&job=` | Terminates the pod's MicroVM and deletes its saves. 404: already gone |
| Into the pod | `ANY /pods/:podId/control/*` | Forwarded to staklink in the pod, with the pod's password and the MicroVM's token added; long polls, SSE and WebSockets included. Rolls the pod over first, as a claim does |
| An image | `POST /workspaces/:workspace/images`, the zip as its body | Puts the zip in the bucket and starts the build (§4). Answers `{ imageId }` |
| Its state | `GET /workspaces/:workspace/images/:imageId` | `building`, `ready`, or `failed` and why. The newest ready image is the workspace's current one |
| A link | `POST /pods/:podId/links { port }` | A signed link that opens one of the pod's ports in a browser (§8) |
| Usage | `GET /usage?from=&to=` | The tenant's metered use (§2.3) |

There's no sleep or wake call: Lambda suspends an idle MicroVM by itself,
and the next request resumes it.

Stakwork's operators manage tenants with an admin token,
`PODS_ADMIN_TOKEN`, on `/admin/*`: make a tenant (its token is answered
once), replace its token, set its limits, read every tenant's usage, and
delete a tenant (its pods terminated, its images and saves deleted). A
service with no admin token has one tenant, whose token is `PODS_TOKEN` in
its own environment: the self-hosted case.

### 2.2 Tenants and tokens

- A tenant is one box. The service keeps its name, its limits and its
  token's hash.
- Stakwork makes a tenant when it provisions a box, and sets the token in
  that box's strut (§10).
- A token reaches only its tenant's pods and images. Replacing it, or
  deleting the tenant, cuts that box off at once, without touching AWS or
  any other box.
- Everything the service puts in the bucket or names in Lambda starts
  with the tenant: `images/<tenant>/<workspace>/`, `saves/<tenant>/<pod>/`.
- A tenant's limits: MicroVMs at once, running or suspended, and their
  largest size. The account's memory quota (§1) is shared by every tenant,
  and suspended MicroVMs count against it, so no tenant can take all of
  it. A claim past a limit answers 503 with `Retry-After`.
- A pod's password is made by the service, kept sealed in its database,
  and added to every call it forwards. Strut never sees it.

### 2.3 Metering

Per tenant and per pod, the service records each MicroVM's size, its time
running and suspended, its suspends and resumes, and the GB kept for the
tenant's images and saves. Lambda suspends and resumes a MicroVM by
itself, so the service reads each live MicroVM's state as it forwards a
call and on a sweep every few minutes (§15 item 6). `GET /usage` answers
one tenant, `/admin` every tenant. Billing customers from it is
Stakwork's own work.

### 2.4 Its state and its releases

- Its state is one SQLite file on its volume: tenants, pods and images.
  Its cloud settings (the key, the region, the bucket and the build role)
  are in its environment, from the template's outputs (§9).
- Its image follows `stable`. Stakwork's service serves boxes whose
  packages move on different nights, so its API only grows: a call goes
  away only once no box's package uses it. The promote moves the image
  first, and the branch once Stakwork's service runs it, so no box gets a
  package before the service it needs.

### 2.5 What it costs

- **Stakwork's service must stay up.** A hosted box's pods depend on it,
  as its calls depend on the central LiveKit; nothing else on the box
  does. While it's down, jobs can't reach their pods. Nothing is lost: a
  pod suspends and expires as it would, and staklink writes its saves to
  the bucket without the service.
- **An extra hop on each agent tool call**: strut, the service, then the
  MicroVM. Everything goes through the service at first. If the trial
  shows the hop is slow (§14 step 1), the service can hand strut a
  short-lived token for one pod (`CreateMicrovmAuthToken`: its ports and
  expiry) and the pod's password, so exec goes straight to the MicroVM.
- **A self-hoster's service is an always-on container** on their box. The
  pods themselves still cost nothing while idle.

## 3. The package

```
package/            in stakwork/pods
  strut.yaml
  steps/
    _pods.ts        a call to the service, and the job's pod from its hold
    claim.ts        release.ts     workspace.ts   template.ts   link.ts
    bash.ts         edit.ts        overview.ts    search.ts     fetch.ts
    latest.ts       push.ts
  workflows/
    pod-template.yaml
    code-change-pr.yaml   code-change-propose.yaml   code-change-land.yaml
  concepts/
    Code Change.md   Pod.md   Pod Config.md   Pod Setup - <service>.md …
```

```yaml
# strut.yaml
package: stadeum/pods
version: 0.1.0
job:
  tools: [claim, release, bash, edit, overview, search, fetch, latest, push, link, workspace]
  approve: [workspace]
requires:
  secrets: [PODS_URL, PODS_TOKEN]
```

`PODS_URL` isn't secret, but a step reads only the secrets its package
lists (the fence, strut `src/packages/fence.ts`), so that's how a step
gets a setting. Until both are set, strut installs nothing of the package
(§10).

| Step | Does |
| --- | --- |
| `claim` | The job's pod, through the service's claim: launched on the first call, the same pod on later ones (§5) |
| `release` | Drops the pod through the service; also run by strut's idle sweep, through the hold |
| `workspace` | Makes or changes a workspace (its repositories), on its Concept page. Runs only as a proposal an admin accepted |
| `template` | Zips a workspace and hands it to the service, which builds its image (§4); the `pod-template` workflow's last step |
| `bash`, `edit`, `overview`, `search` | The agent's tools in the pod, with the contracts of strut's local `bash`, editor, `repo_overview` and `fulltext_search` (strut `plans/pods.md` §1) |
| `fetch` | Copies a file from the pod into the job's directory, so it can be a deliverable |
| `latest`, `push` | Git in the pod, run through the exec service: fetch and reset to a base branch; push a branch and open a PR with the person's token, passed per call and never in the pod's environment. The service forwards it and keeps none of it |
| `link` | A signed link to one of the pod's ports, for a person or strut's browser steps (§8) |

Each step is a call to the service, or a few. The steps find the job's pod
from its hold (`ctx.services.jobs`), which records `{ pod, workspace }`, so
the model never copies a pod id. The pages and the three `code-change-*`
workflows come from the lab (`mcp/src/lab/code/`, `mcp/src/lab/pods/`,
`mcp/src/lab/pod-setup/`). The workflows use only strut's own steps. `Pod`
is rewritten around this plan and the memory loop (§6), and `Pod Config`
around `.devcontainer/` and PRs.

## 4. A workspace and its image

**A workspace** is a name and its repositories (`url`, `branch`). They're
kept on its Concept page, `<workspace> pod` under `Pod`, which also holds
what jobs learned about running it. `workspace` writes them. The service
knows a workspace only by its name and its images.

**An image per workspace**, made by `pod-template`:

1. `git/checkout` of each repository at its branch, with the run's token,
   in strut. No token goes into the image or to the service.
2. The zip: the main repository's `.devcontainer/Dockerfile` (the default:
   `FROM ghcr.io/stakwork/staklink-js`), the repositories, the compose file
   and the pm2 config, and the pod layer the package adds: dockerd and its
   config (Lambda's resolver for containers), code-server, and an
   entrypoint.
3. `template` sends it to the service (`POST /workspaces/:workspace/images`).
   The service puts it at `images/<tenant>/<workspace>/<n>.zip` in its
   bucket and runs `create-microvm-image` (or `update-microvm-image`) with
   the build role, `ALL` capabilities, and staklink's port for the hooks.
   `template` waits until the image is `ready`.
4. During the build the entrypoint starts dockerd, `docker compose up -d`
   for every service but `app` (pulling their images onto the disk),
   `pm2 start`, and staklink. `/ready` answers 200 once every compose
   service is healthy and every pm2 app is online. The snapshot then holds
   them running, with the installs done and the images pulled.

`pod-template` runs when a workspace is made, when a PR changes its
`.devcontainer/` (seen by the nightly run, which compares the commit), and
nightly at 03:00 in the box's time zone, so a new pod doesn't start far
behind its base branch. A package can't ship an automation, so a
workspace's first `pod-template` run makes the nightly one with strut's
`automation/create`. The account builds 5 images at once (§1), shared by
every tenant, so the service queues builds.

A new pod starts at its image's commits, and `latest` brings it forward.
The workspace's `<workspace>/boot` workflow runs on the first claim, and
is quick when the image already has everything up. The disk is at most
32 GB: images, repositories, `node_modules` and the databases must fit.

## 5. Claim, sleep, wake, and the 8-hour chain

**Claim.** On the job's first claim, the service runs `run-microvm` from
the workspace's current image:
- `maximumDurationInSeconds` 28,800;
- `idlePolicy`: auto-resume on, 10 minutes idle before a suspend,
  suspended for the rest of the 8 hours;
- the run payload `{ pod, job, password, saves }`: the password is made
  fresh per pod for staklink, and `saves` holds signed URLs for this pod's
  saves alone: one to write the git part, one to write a full save, and
  one to read a save to put back, if there is one.

There's no execution role, so a MicroVM holds no AWS credential. One role
for every pod would let a repository's code read every tenant's saves. The
signed URLs reach only this pod's, and last past its 8 hours.

The service records `{ microvm, workspace, image, startedAt }` and the
password, sealed. The hold in strut records `{ pod, workspace }`. Every
later claim returns the same pod.

**A call.** A step sends its request to the service's
`/pods/:podId/control/*`. The service forwards it to the MicroVM's
endpoint with the pod's password, and its token in `X-aws-proxy-auth`,
minting a new token when the one it holds is near expiry. A suspended
MicroVM resumes on the request.

**Sleep.** Lambda suspends a MicroVM after 10 minutes with no traffic
through its endpoint. An exec command strut is still reading keeps it
awake, because its long-poll reads are traffic. A dev server left running
between turns doesn't, so the pod sleeps with the dev server in memory and
wakes with it.

**Saves.** A save is what a pod changed, in `saves/<tenant>/<pod>/` in the
service's bucket, written by staklink to the signed URLs its run payload
gave it:
- each repository's branch, a `git bundle` of its commits that aren't on
  the remote, and its working tree's changes, untracked files included
  (ignored ones not);
- at a rollover only, each compose volume, with the services stopped so
  the copy is consistent.

staklink writes the git part at every `suspend` hook (small and fast),
and all of it at `terminate`.

**The chain.** The service rolls a pod over at its next use: a claim, or a
call into the pod, that finds its MicroVM older than 7 hours, or gone. The
service is always on and could watch the clock, but a rollover at the next
use spends nothing on a pod nobody comes back to. It:
1. asks staklink for a full save, if the MicroVM still answers;
2. terminates it;
3. runs a new MicroVM from the workspace's current image, with new signed
   URLs and the save to read;
4. `run` puts the save back: the bundles fetched, the branches checked
   out, the working trees restored, the volumes restored before compose
   comes up.

A rollover loses the running processes (the image's entrypoint and
`<workspace>/boot` start them again) and anything outside the save. If a
MicroVM expires without its `terminate` hook (§15 item 2), the last
`suspend` save has the code. Database changes since the last rollover are
lost; `boot` seeds the database again.

**Release.** The job lets go (`release`, a deleted job, or strut's 7-day
idle sweep through the hold), and the service terminates the MicroVM and
deletes the pod's saves. An S3 lifecycle rule deletes saves older than 14
days, as a backstop.

## 6. The agent in a pod, and what it learns

As strut `plans/pods.md` §1 and §3 say, with the tools as package steps:
- **The tools** act on the job's pod. Before a claim they answer "this job
  holds no pod: claim one".
- **A run's commands** are killed when the run ends. Services under pm2 or
  Docker outlive it, which is how an app stays up between turns.
- **The memory loop.** How things are goes on the workspace's page: the
  services, ports, test user, and what broke. How to do things goes into
  workflows: `<workspace>/boot` brings the stack up from any state, and a
  story walks the app to a page. Each carries claims that strut's verify
  pass checks, so a stale procedure says so, and the agent mends it and
  publishes it again with the `meta/*` tools.

Claude Code, Codex or goose working inside a pod (strut `plans/pods.md`
§6) is later work. It needs a pod-hosted ACP stream, which this package
can't add to `acp/prompt`.

## 7. staklink in a MicroVM

staklink gains, in its own repository and release:

| What | Does |
| --- | --- |
| The exec routes | strut `plans/pods.md` §2, unchanged: `POST /exec`, `GET /exec/:id?offset=&wait=`, `POST /exec/:id/kill`, `GET /exec/stream`, `/files`, `GET /busy` |
| `start --serve-only` | Its control server, the exec service and code-server, with none of `startup()`'s procedures |
| `ready` | 200 once every compose service is healthy and every pm2 app is online |
| `run` | Reads the payload: the pod's password, its signed save URLs, and a save to put back (§5) |
| `resume` | Fixes the clock and anything else a long sleep breaks |
| `suspend` | Writes the git part of a save to its signed URL |
| `terminate` | Writes a full save to its signed URL |

The pod's password stays: the MicroVM's token admits anyone who holds
one, and the password is a second check, kept by the service and added to
every call it forwards.

## 8. Reaching a pod from a browser

People open a pod's frontend and its IDE; strut's browser steps open the
frontend for a story or a check. Neither can add a header to a page load,
and a MicroVM takes its token only in a header or a WebSocket subprotocol.
The pods service is in the path already, so it adds them.

- **A name per pod and port**, in Hive's scheme (`buildPodUrl`):
  `<pod>-<port>.<pods host>`. A dev server is served at `/`, as most
  assume, and its WebSockets (hot reload, the IDE) go through with the
  subprotocols added. Stakwork's service has one wildcard name and one
  wildcard certificate for every tenant's pods.
- **Signed links.** `link { port }` asks the service for a link to one of
  the job's pod's ports. The service signs `{ pod, exp }` with a key of its
  own, good for 10 minutes. Opening it sets an HttpOnly, `Secure` cookie
  named for the pod, good for 12 hours on every one of that pod's names.
  The service checks the cookie on every request, strips it before
  forwarding, so the pod's code never sees it, and adds the MicroVM's
  token.
- **Who gets one.** The job agent: it opens the link with strut's browser
  steps, or hands it to the person in a reply. A person whose cookie ran
  out asks the job for another. Within its 10 minutes, a link opens the
  pod for whoever holds it.
- **Not the control server.** A link to staklink's control port is
  refused: exec goes only through the API, with the tenant's token.
  code-server keeps its own password behind the cookie, as staklink's
  `/ide-auth` does today.
- **Nothing in strut.** Strut needs no proxy route and no signing key, and
  the service knows no strut session.

This settles the earlier revision's three options: a strut route (a strut
change, and a wildcard certificate on every box), a proxy in AWS (the
service is that proxy), and a tunnel from the pod (a credential in it). A
self-hosted box's pod names are open (§15 item 7).

## 9. The AWS template

`aws/pods.yml` in the pods repository: a CloudFormation template for a
pods service's account, run once per account and region.

| Resource | For |
| --- | --- |
| The pods bucket | `images/` (the zips) and `saves/`, with a lifecycle rule on `saves/` |
| The service's IAM user and access key | The MicroVM actions, the bucket, and `iam:PassRole` on the build role; nothing else |
| The build role | Reads `images/` |
| A budget alarm | Mail when a month's MicroVM spend passes a set amount |

There's no execution role: a MicroVM writes its saves to signed URLs
(§5). The outputs are the service's settings, never strut's.

- **Hosted boxes** need none of it. Stakwork runs it once for its service,
  and a box gets a tenant and its token.
- **A self-hosted box (later)** runs it once, in its own account, for its
  own service. The admin puts the outputs in the box's `.env`, for the
  `pods` container alone (§10).

The box itself depends on no AWS service (rule 5).

## 10. How a box follows pods

Through a strut subscription to a git branch, not a `STRUT_REPOS` list
(strut `plans/followed-repos.md` §1 and §4):

```
PUT /packages/subscriptions/pods
{ "ref": "git+https://github.com/stakwork/pods@stable#package" }
```

**Who subscribes.** ops, with the deployment key (strut's
`STRUT_API_KEY`), at first boot. The packages a box follows are listed in
ops's image, so the list rides Stadeum's release, not `.env`: a release
can add a package to every box.

**When it moves.** Only in the upkeep window. Strut runs with
`STRUT_DISTRO_POLL_MINUTES=0`, so it reads its subscriptions once at boot
and never moves one by itself. Each night, inside the drain ops takes for
strut's image and after that image moved, ops calls
`POST /packages/subscriptions/pods/sync`. It records the commits from and
to, as it records an image's. A package that needs the newer strut goes in
the same night. On a night strut's image doesn't move, ops syncs without a
drain, as a person's install from the Packages page goes in without one.
A sync that fails keeps what's installed, and ops records why. A
self-hosted box's `pods` container moves in strut's group, so the service
and the package move the same night, the service first.

**A rollback** is `stable` moved back, applied at the next window or on
Update now.

**Secrets.** A package that lacks any secret it requires isn't installed
at all: no tools for the job agent, and no Concept pages (owner,
2026-11-18). So a box without `PODS_URL` and `PODS_TOKEN` has no pods, and
no `Code Change` page telling Jamie it can change code. The subscription
says `waiting` and names them. A secret removed later takes the package
out at the next sync. A replaced token doesn't: the package stays, and its
calls answer 401 until the new token is set.
- **Hosted boxes first.** At provisioning, Stakwork makes the box a tenant
  of its service and sets `PODS_URL` and `PODS_TOKEN` in strut: in strut's
  environment, which strut's secrets fall back to, or with
  `PUT /secrets/:name`.
- **Self-hosted boxes (later).** The box runs the service as an optional
  container, `pods`, as it runs the treasury's image. The admin runs the
  template in their own account (§9) and puts its outputs in `.env` with a
  `PODS_TOKEN`. Strut gets `PODS_URL` (`http://pods:<port>`, on the
  stack's network) only once that token is set, so the gate keeps the
  package out until then. Without its settings the container waits, as the
  treasury waits for its tokens. stadeum's Packages page sets only an
  installed package's missing secrets today, and nothing of a waiting
  package is installed. So the page must show a waiting subscription and
  the secrets it needs.

**The box where pods are developed.** Jamie develops pods on a box that
opens `stakwork/pods` on `main`, at `package/` (strut's Packages → Repos),
instead of subscribing. `package/commit` there opens PRs against `main`. A
box can't do both. Strut has a known gap here: a Commit takes every
Concept page made under the package's pages. Each workspace's
`<workspace> pod` page hangs under `Pod`, so a Commit would put what jobs
learned about the org's repositories in a PR on the public pods
repository. Strut fixes that before pods are developed this way (strut
`plans/followed-repos.md` §5).

## 11. The risk we accepted

Strut's agents run shell commands in strut's container (rule 4), so an
agent, or a prompt that steers one, can read `PODS_TOKEN`. With it,
someone can, for this box's tenant only:
- launch pods, up to the tenant's limits: spend, which the service meters;
- run commands in any of the box's pods and read what's in them: the
  org's own code;
- drop the box's pods, and their saves with them.

This is accepted as the treasury's pay token is (rule 4). The token never
reaches another box's pods, the cloud account or the service's keys, and
Stakwork replaces it for one box without touching any other.

What the earlier revision accepted goes away: there's no AWS key in
strut, and no role in a pod that reaches the whole bucket. The cloud keys
are in the service: Stakwork's, outside every box, for hosted boxes; the
`pods` container's alone on a self-hosted box, which rule 4 then names
beside the treasury's admin token. A person's GitHub token passes through
the service on `latest` and `push`, and the service keeps none of it.

Code running in a pod (a repository's own code) holds that pod's signed
URLs, and can read or write that pod's saves. That's its own work, so
that's accepted.

## 12. Cost

A pod costs about $0.25 an hour while it runs (2 vCPU / 4 GB), and a few
cents for each suspend and resume. Each workspace's image costs its
snapshot storage, about $0.08 per GB-month, plus the saves (small). A pod
used four hours every workday costs about $20 a month.
- **Hosted boxes**: in Stakwork's account. The service meters each box
  (§2.3), for Stakwork to bill.
- **A self-hosted box**: in its own account, plus the `pods` container on
  the box: a small always-on process, and no other machine.
- **Stakwork's service**: one deployment for every hosted box, whatever
  the number of pods.

## 13. What changes, by file

**stakwork/pods** (new; proposed, not created)
- `service/`: the service (§2), published as `ghcr.io/stakwork/pods`.
- `package/`: the package (§3).
- `aws/pods.yml`: the template (§9).
- Its promote: the image's `stable` tag first, then the `stable` branch
  once Stakwork's service runs the new image (§2.4).

**stadeum**
- `ops/src/`: the list of packages a box follows, the subscription at
  first boot, and its sync in the upkeep window, recorded with the commits
  from and to (§10).
- `stack/stadeum.yml`: `STRUT_DISTRO_POLL_MINUTES=0` on strut.
- `scripts/promote.sh pods`: runs the pods repository's promote.
- `AGENTS.md`: rule 4 names `PODS_TOKEN` among what strut holds; the
  layout; a roadmap step.
- Later, for self-hosted boxes: the `pods` service in `stack/stadeum.yml`,
  waiting without its settings, in strut's update group, with its volume
  in the backup; its settings in `.env.example`; its names in the
  Caddyfile (§15 item 7); `docs/stack-spec.md`; and the Packages page
  showing a waiting subscription and the secrets it needs (§10).

**Other repositories** (each its own work)
- **strut**: the three work items in its revised `plans/followed-repos.md`
  (stakwork/strut#738): `git+` subscriptions (built, stakwork/strut#739),
  the secrets gate, and the `job` grant. That plan's examples name the old
  ref and the AWS secrets; they become
  `git+https://github.com/stakwork/pods@stable#package` and
  `[PODS_URL, PODS_TOKEN]`. Later, before pods are developed from a box,
  the Commit gap (§10). Then `plans/pods.md` marked replaced by this plan.
  No proxy route: the service answers §8.
- **staklink**: §7.
- **stakgraph**: the lab keeps its `pod/*` while Hive's pods run.
- **fleet**: Stakwork's service (the template run once, the service
  deployed with its domain, wildcard certificate and database backup), and
  a tenant and its token for each hosted box.

## 14. Steps

1. **The trial**, by hand in one AWS account, before any code:
   - an image from hive's `.devcontainer/` with Docker, compose and pm2
     running when the snapshot is taken (DNS for containers, 32 GB of
     disk);
   - launch to the first HTTP 200, and an idle suspend and an
     auto-resume;
   - a page of the dev server through the endpoint, with a proxy adding
     the token (the request and bandwidth limits, and WebSockets for hot
     reload and the IDE), and what the hop adds to an exec long poll;
   - whether `terminate` runs for a suspended MicroVM that expires;
   - a save written to a signed URL from inside a MicroVM, and whether a
     build's Dockerfile can reach the build role.

   The numbers go into §1.
2. **The pods repository and the service's core**: tenants and tokens,
   claim, drop, calls into a pod, images; the template; Stakwork's
   deployment.
3. **The subscription in ops and `promote.sh pods`.** Strut's `git+`
   subscriptions are built (stakwork/strut#739).
4. **The package's core**: `claim`, `release`, `workspace`, `template`,
   `pod-template`. Needs strut's secrets gate and `job` grant (its work
   items 2 and 3) and staklink's hooks.
5. **The agent's tools** and `latest`, `push`, `fetch`. Needs staklink's
   exec routes.
6. **Saves and the chain** (§5), in the service and staklink.
7. **A browser into a pod**: the names, the links and `link` (§8).
8. **The pages and the `code-change-*` workflows**, with `Pod` and
   `Pod Config` rewritten.
9. **Metering** (§2.3), before a hosted customer is billed for pods.
10. **A live run.** A hosted Stadeum box with pods for the `hive`
    workspace, through Stakwork's service:
    - a push to `stable` goes in at the next upkeep window, and not before;
    - a job claims a pod, runs the tests, and leaves its changes
      uncommitted;
    - the pod sleeps, and a turn hours later finds it as it was;
    - after 8 hours, a turn finds it rolled over, with its changes;
    - a person opens the pod's frontend from a link the job handed over;
    - the job opens a PR;
    - a second box's token sees none of the first box's pods, and a
      replaced token cuts the first box off.

## 15. Open

1. Whether compose's services come up during the image build and survive
   in the snapshot, and what DNS the containers need.
2. Whether `terminate` runs for a suspended MicroVM that expires, and how
   long it gets. If it doesn't, the service, which is always on, can wake
   a pod near its 8 hours for a full save.
3. Whether 32 GB of disk is enough for a real workspace, and whether the
   endpoint's limits, with the service's hop, make a dev server slow.
4. How long an image build takes, and whether 5 builds at once, shared by
   every tenant of Stakwork's service, is enough for many boxes' nightly
   runs.
5. Whether a build's Dockerfile, a repository's own code, can reach the
   build role's credentials. If it can, each tenant needs a build role of
   its own that reads only its images.
6. How the service learns a MicroVM's state for metering: a sweep, or
   events from Lambda if it sends them. And whether a MicroVM can carry a
   cost-allocation tag per tenant.
7. A self-hosted box's pod names. A wildcard certificate under its host
   needs a DNS-01 challenge (a Caddy with a DNS module, and a token for the
   box's DNS), and a certificate per name runs into Let's Encrypt's weekly
   limit.
8. Every tenant's pods share the pods domain, so one pod's page could set
   a cookie for another pod's names. Whether to put the domain on the
   Public Suffix List.
9. The account's quotas (§1), shared by every hosted box: when to ask AWS
   for more, or to split tenants across accounts.
