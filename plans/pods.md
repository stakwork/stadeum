# Pods: a machine of its own for every coding job, on Lambda MicroVMs

> **Status (2026-11-18): proposed. Nothing is built.** From one design
> conversation with the owner on 2026-11-17. Revised on 2026-11-18 to match
> strut's revised `plans/followed-repos.md`: a box follows pods through a
> strut subscription, not a `STRUT_REPOS` list. In "Decided", **agreed**
> rows are the owner's; **proposed** rows are mine and stand until the
> owner rules. This plan replaces strut's `plans/pods.md` (2026-11-10),
> which put pods on an always-on pod box per org. It keeps that plan's
> agreed parts: strut's agent works in the pod through an exec service,
> and what a job learns about running the app is kept in strut (strut
> `plans/pods.md` §1–§3). Read against stadeum `main` @0b0196e (@bbbc85c
> for the revision), strut `main` @e6b5539c, strut's revised
> `plans/followed-repos.md` (stakwork/strut#738, on @5b33e939: `git+`
> subscriptions, a package that lacks a secret kept out, and tools a
> package gives the job agent), stakgraph `main` @ee46d0db (the lab's
> `pod/*` steps and its `Pod`, `Pod Config` and `Code Change` pages) and
> staklink `main` @843c13f.

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

## Decided

| Question | Decision |
| --- | --- |
| What a pod runs on | **proposed**, to meet the owner's requirements (**agreed** 2026-11-17: nothing spent while idle, VM isolation, the box's own AWS). AWS Lambda MicroVMs: AWS's Firecracker sold by API. Compute is billed per second while a MicroVM runs. A suspended one costs only snapshot storage, and a terminated one costs nothing. There's no server of ours (§1). |
| Whose AWS account | **agreed.** The account of whoever runs the box: Stakwork's for the boxes it hosts, the customer's own beside a self-hosted box. |
| Rule 5 (any cloud) | **proposed.** It holds for the box. Pods are an optional package that needs an AWS account. A box without one has no pods, and nothing else on it changes. Another provider can come later behind the same steps. |
| How pods reach strut | **agreed (2026-11-18: "git+ refs in subscriptions is the way").** A strut package, `stadeum/pods`, that the box follows through a strut subscription to a git branch: `PUT /packages/subscriptions/pods { ref: "git+https://github.com/stakwork/stadeum@stable#packages/pods" }` (strut `plans/followed-repos.md` §1). It's strut content, not stadeum code (rule 1). Stadeum's part is the subscription, its sync in the upkeep window (§9) and the AWS template (§8). |
| Where the package lives | **proposed.** In this repo, at `packages/pods/`. The repo is public, so the subscription needs no token. |
| The branch boxes follow | **proposed.** `stable`, which `scripts/promote.sh pods` moves to main's head (rule 7: pinned to a channel, never latest). A rollback is `stable` moved back. Jamie's PRs go to `main`. |
| Who subscribes a box | **proposed.** ops, with the deployment key, at first boot. The package list rides Stadeum's release, not `.env` (§9). |
| When the package moves | **agreed (2026-11-18: "the same schedule as updating images").** Each night in the upkeep window, after strut's image. Strut's own poll is off, and ops syncs the subscription (§9). The route is proposed. |
| A box without the AWS secrets | **agreed (2026-11-18: "disable the package completely (tools and concepts)").** Nothing of pods is installed until every secret the package requires is set: no tools, no Concept pages (§9). |
| Which boxes first | **agreed (2026-11-18).** The boxes Stakwork hosts. Stakwork sets their AWS secrets at provisioning. Self-hosted boxes come later (§9). |
| Where pods are developed | **proposed.** On a box that opens this repo on `main` instead of subscribing (§9). |
| npm dependencies in its steps | **agreed (2026-11-17: "Vendor for now").** A step imports `strut` and its own helper files. The steps sign their AWS requests themselves: SigV4 with `node:crypto` in `steps/_aws.ts`, sent through `ctx.services.http`. |
| Where the agent's loop runs | **agreed (strut `plans/pods.md`, 2026-11-10).** In strut. Only its tools run in the pod, through an exec service. A pod holds no strut credential. |
| The exec service | **settled (same plan).** staklink's, with the MicroVM hooks added (§6). It's in every workspace image already: `FROM ghcr.io/stakwork/staklink-js`. |
| A pod's life | **proposed.** A pod is the job's until the job lets it go. A MicroVM lives at most 8 hours, suspended time included, and AWS won't raise that. So a pod is a chain of MicroVMs, and its changes are saved to S3 between one and the next (§4). |
| A workspace's template | **proposed.** One MicroVM image per workspace, built from its Dockerfile with its repositories inside. The services are started during the build and snapshotted running (§3). |
| A workspace's devcontainer files | **proposed.** The main repository's `.devcontainer/` (`Dockerfile`, `docker-compose.yml`, `pm2.config.js`), or the defaults when it has none. A fix reaches every pod through a PR to the repository. This replaces Hive's per-workspace store (`Pod Config`). |
| The AWS key in strut | **proposed: the risk is accepted**, as the run archive's key is (rule 4). It's scoped to MicroVMs, the pods bucket and the two roles (§10). |
| Backups | **proposed.** Pods aren't in the box's backup (rule 8). A pod holds work in progress. Pushed work is in GitHub, what the agent learned is in strut's graph (backed up), and images are rebuilt from the repositories. |
| A person's browser opening a pod | **open** (§7). |

## 1. What a Lambda MicroVM gives

From AWS's developer guide (`microvms-how-it-works`, `-images`,
`-images-snapshots`, `-launching`, `-networking`, and the quotas page),
read 2026-11-17. Numbers marked *third-party* come from one early test and
need the trial to confirm them (§13 step 1).

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

## 2. The package

```
packages/pods/
  strut.yaml
  steps/
    _aws.ts         SigV4 signing, and the MicroVM and S3 calls the steps make
    _pod.ts         the job's pod from its hold, the auth token, a call to staklink
    claim.ts        workspace.ts   template.ts   release.ts
    bash.ts         edit.ts        overview.ts   search.ts     fetch.ts
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
  tools: [claim, release, bash, edit, overview, search, fetch, latest, push, workspace]
  approve: [workspace]
requires:
  secrets: [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, PODS_REGION, PODS_BUCKET, PODS_BUILD_ROLE, PODS_EXEC_ROLE]
```

The fence (strut `src/packages/fence.ts`) lets only this package's steps
read those secrets. Until all six are set, strut installs nothing of the
package (§9).

| Step | Does |
| --- | --- |
| `claim` | The job's pod: the first call launches one from the workspace's image, and later calls return the same pod (§4) |
| `release` | Terminates the pod's MicroVM and deletes its saves; also run by strut's idle sweep, through the hold |
| `workspace` | Makes or changes a workspace (its repositories), on its Concept page. Runs only as a proposal an admin accepted |
| `template` | Builds or rebuilds a workspace's image (§3); the `pod-template` workflow's last step |
| `bash`, `edit`, `overview`, `search` | The agent's tools in the pod, with the contracts of strut's local `bash`, editor, `repo_overview` and `fulltext_search` (strut `plans/pods.md` §1) |
| `fetch` | Copies a file from the pod into the job's directory, so it can be a deliverable |
| `latest`, `push` | Git in the pod, run through the exec service: fetch and reset to a base branch; push a branch and open a PR with the person's token, passed per call and never in the pod's environment |

The steps find the job's pod from its hold (`ctx.services.jobs`), so the
model never copies a MicroVM id or a password. The pages and the three
`code-change-*` workflows come from the lab (`mcp/src/lab/code/`,
`mcp/src/lab/pods/`, `mcp/src/lab/pod-setup/`). The workflows use only
strut's own steps. `Pod` is rewritten around this plan and the memory
loop (§5), and `Pod Config` around `.devcontainer/` and PRs.

## 3. A workspace and its image

**A workspace** is a name and its repositories (`url`, `branch`). They're
kept on its Concept page, `<workspace> pod` under `Pod`, which also holds
what jobs learned about running it. `workspace` writes them.

**An image per workspace**, made by `pod-template`:

1. `git/checkout` of each repository at its branch, with the run's token,
   in strut. No token goes into the image.
2. The zip: the main repository's `.devcontainer/Dockerfile` (the default:
   `FROM ghcr.io/stakwork/staklink-js`), the repositories, the compose file
   and the pm2 config, and the pod layer the package adds: dockerd and its
   config (Lambda's resolver for containers), code-server, and an
   entrypoint.
3. Uploaded to `s3://$PODS_BUCKET/images/<workspace>/<n>.zip`, then
   `create-microvm-image` (or `update-microvm-image`) with the build role,
   `ALL` capabilities, and staklink's port for the hooks.
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
`automation/create`.

A new pod starts at its image's commits, and `latest` brings it forward.
The workspace's `<workspace>/boot` workflow runs on the first claim, and
is quick when the image already has everything up. The disk is at most
32 GB: images, repositories, `node_modules` and the databases must fit.

## 4. Claim, sleep, wake, and the 8-hour chain

**Claim.** On the job's first claim, `run-microvm` starts a MicroVM from
the workspace's current image:
- `maximumDurationInSeconds` 28,800;
- `idlePolicy`: auto-resume on, 10 minutes idle before a suspend,
  suspended for the rest of the 8 hours;
- the execution role;
- the run payload `{ pod, job, password, save? }`: the password is made
  fresh per pod for staklink, and `save` is the key of a save to put back.

The hold records `{ microvm, workspace, image, startedAt }`, with the
password and the current auth token sealed (AES-GCM under a key derived
from the AWS secret, as the lab seals under `HIVE_API_KEY`). Every later
claim returns the same pod.

**A call.** `_pod.ts` sends the request to the MicroVM's endpoint with the
token in `X-aws-proxy-auth`, minting a new token when the sealed one is
near expiry. A suspended MicroVM resumes on the request.

**Sleep.** Lambda suspends a MicroVM after 10 minutes with no traffic
through its endpoint. An exec command strut is still reading keeps it
awake, because its long-poll reads are traffic. A dev server left running
between turns doesn't, so the pod sleeps with the dev server in memory and
wakes with it.

**Saves.** A save is what a pod changed, in
`s3://$PODS_BUCKET/saves/<pod>/`, written by staklink with the execution
role:
- each repository's branch, a `git bundle` of its commits that aren't on
  the remote, and its working tree's changes, untracked files included
  (ignored ones not);
- at a rollover only, each compose volume, with the services stopped so
  the copy is consistent.

staklink writes the git part at every `suspend` hook (small and fast),
and all of it at `terminate`.

**The chain.** No server watches the clock, so a rollover happens at the
next use. A step that finds the pod's MicroVM older than 7 hours, or gone:
1. asks it for a full save, if it still answers;
2. terminates it;
3. runs a new MicroVM from the workspace's current image, with the save's
   key in the run payload;
4. `run` puts the save back: the bundles fetched, the branches checked
   out, the working trees restored, the volumes restored before compose
   comes up.

A rollover loses the running processes (the image's entrypoint and
`<workspace>/boot` start them again) and anything outside the save. If a
MicroVM expires without its `terminate` hook (§14 item 3), the last
`suspend` save has the code. Database changes since the last rollover are
lost; `boot` seeds the database again.

**Release.** The job lets go (`release`, a deleted job, or strut's 7-day
idle sweep through the hold): terminate, then delete the pod's saves. An
S3 lifecycle rule deletes saves older than 14 days, as a backstop.

## 5. The agent in a pod, and what it learns

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

## 6. staklink in a MicroVM

staklink gains, in its own repository and release:

| What | Does |
| --- | --- |
| The exec routes | strut `plans/pods.md` §2, unchanged: `POST /exec`, `GET /exec/:id?offset=&wait=`, `POST /exec/:id/kill`, `GET /exec/stream`, `/files`, `GET /busy` |
| `start --serve-only` | Its control server, the exec service and code-server, with none of `startup()`'s procedures |
| `ready` | 200 once every compose service is healthy and every pm2 app is online |
| `run` | Reads the payload: the pod's password, and a save to put back (§4) |
| `resume` | Fixes the clock and anything else a long sleep breaks |
| `suspend` | Writes the git part of a save |
| `terminate` | Writes a full save |

The pod's password stays: the MicroVM's endpoint token admits anyone who
holds one, and staklink's password says which pod a request is for.

## 7. Reaching a pod from a browser (open)

People open a pod's frontend and its IDE; strut's browser steps open the
frontend for a story or a check. Neither can add a header to a page load,
and a MicroVM takes its token only in a header (or a WebSocket
subprotocol). The pod's frontend needs WebSockets (hot reload, the IDE),
and most dev servers assume they're served at `/`.

| Option | For | Against |
| --- | --- | --- |
| **A strut route that proxies a job's hold** (a strut change): a package step hands strut `{ url, headers }` for a hold, strut checks the person's session and forwards HTTP and WebSockets, on a name per pod under `strut.$HOST` | One sign-in, strut's. General: any package that wraps a service with header auth gets it | A strut change; a name per pod needs a wildcard certificate (DNS-01) in Caddy |
| **A proxy in AWS** beside the pods (CloudFront and a function that swaps a strut-signed link for the header) | Nothing on the box changes | Another service in the customer's account; WebSockets through it are harder |
| **An outbound tunnel** from the pod | No inbound path | A third party in the path; a credential in the pod |

My lean is the strut route. The trial (§13 step 1) shows what a dev server
needs through each option.

## 8. The AWS template

`stack/aws/pods.yml`, a CloudFormation template run once per account and
region by an admin, or by fleet for each box it hosts (fleet's own work):

| Resource | For |
| --- | --- |
| The pods bucket | `images/` (the zips) and `saves/`, with a lifecycle rule on `saves/` |
| strut's IAM user and access key | The MicroVM actions, the bucket, and `iam:PassRole` on the two roles below; nothing else |
| The build role | Reads `images/` |
| The execution role | Reads and writes `saves/` |
| A budget alarm | Mail to the admin when a month's MicroVM spend passes a set amount |

Its outputs are the package's secrets (§9 says who sets them). The box
itself depends on no AWS service (rule 5).

## 9. How a box follows pods

Through a strut subscription to a git branch, not a `STRUT_REPOS` list
(strut `plans/followed-repos.md` §1 and §4):

```
PUT /packages/subscriptions/pods
{ "ref": "git+https://github.com/stakwork/stadeum@stable#packages/pods" }
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
A sync that fails keeps what's installed, and ops records why.

**A rollback** is `stable` moved back, applied at the next window or on
Update now.

**Secrets.** A package that lacks any secret it requires isn't installed
at all: no tools for the job agent, and no Concept pages (owner,
2026-11-18). So a box without the template's outputs has no pods, and no
`Code Change` page telling Jamie it can change code. The subscription says
`waiting` and names the secrets. A secret removed later takes the package
out at the next sync.
- **Hosted boxes first.** Stakwork runs the template for each box it hosts
  and sets the outputs at provisioning: in strut's environment, which
  strut's secrets fall back to, or with `PUT /secrets/:name`.
- **Self-hosted boxes (later).** The admin runs the template and sets its
  outputs. stadeum's Packages page sets only an installed package's missing
  secrets today, and nothing of a waiting package is installed. So the page
  must show a waiting subscription and the secrets it needs.

**The box where pods are developed.** Jamie develops pods on a box that
opens this repo on `main` (strut's Packages → Repos) instead of
subscribing. `package/commit` there opens PRs against `main`. A box can't
do both. Strut has a known gap here: a Commit takes every Concept page
made under the package's pages. Each workspace's `<workspace> pod` page
hangs under `Pod`, so a Commit would put what jobs learned about the org's
repositories in a PR on this public repo. Strut fixes that before pods are
developed this way (strut `plans/followed-repos.md` §5).

## 10. The risk we accepted

Strut's agents run shell commands in strut's container (rule 4), so an
agent, or a prompt that steers one, can read the AWS key. With it, someone
can:
- launch MicroVMs: spend, up to the account's memory quota, with the
  budget alarm as the warning;
- read any pod's saves: the org's own code;
- delete images: rebuilt from the repositories.

This is accepted as the run archive's key is: scoped to the MicroVM
actions, one bucket and two roles. Code running in a pod (a repository's
own code) holds the execution role and can read or write any pod's saves
in the bucket. It's the same org's code, so that's accepted too.

## 11. Cost

An idle box costs the images' snapshot storage, about $0.08 per GB-month
for each workspace's image, plus the saves (small). A pod costs about
$0.25 an hour while it runs (2 vCPU / 4 GB), and a few cents for each
suspend and resume. A pod used four hours every workday costs about $20 a
month. All of it is in the account that runs the box.

## 12. What changes, by file

**stadeum**
- `packages/pods/**`: the package (§2).
- `stack/aws/pods.yml`: the template (§8).
- `ops/src/`: the list of packages a box follows, the subscription at
  first boot, and its sync in the upkeep window, recorded with the commits
  from and to (§9).
- `stack/stadeum.yml`: `STRUT_DISTRO_POLL_MINUTES=0` on strut.
- `scripts/promote.sh pods`: moves the `stable` branch to `main`'s head.
- `AGENTS.md`: the risk in rule 4, the layout, a roadmap step.
- Later, for self-hosted boxes: the Packages page shows a waiting
  subscription and the secrets it needs (§9).

**Other repositories** (each its own work)
- **strut**: the three work items in its revised `plans/followed-repos.md`
  (stakwork/strut#738), each its own PR: `git+` subscriptions with
  `POST /packages/subscriptions/:id/sync`; the secrets gate, so a package
  that lacks a required secret stays out; and the `job` grant from a
  package's `strut.yaml`. Later, before pods are developed from a box, the
  Commit gap (§9). Then `plans/pods.md` marked replaced by this plan, and
  possibly the proxy route (§7).
- **staklink**: §6.
- **stakgraph**: the lab keeps its `pod/*` while Hive's pods run.
- **fleet**: the template for each hosted box.

## 13. Steps

1. **The trial**, by hand in one AWS account, before any code here:
   - an image from hive's `.devcontainer/` with Docker, compose and pm2
     running when the snapshot is taken (DNS for containers, 32 GB of
     disk);
   - launch to the first HTTP 200, and an idle suspend and an
     auto-resume;
   - a page of the dev server through the endpoint (the request and
     bandwidth limits) and through each option in §7;
   - whether `terminate` runs for a suspended MicroVM that expires.

   The numbers go into §1.
2. **The template, the subscription in ops and `promote.sh pods`.** Needs
   strut's `git+` subscriptions (its work item 1).
3. **The package's core**: `_aws.ts`, `claim`, `release`, `workspace`,
   `template`, `pod-template`. Needs strut's secrets gate and `job` grant
   (its work items 2 and 3) and staklink's hooks.
4. **The agent's tools** and `latest`, `push`, `fetch`. Needs staklink's
   exec routes.
5. **Saves and the chain** (§4).
6. **The pages and the `code-change-*` workflows**, with `Pod` and
   `Pod Config` rewritten.
7. **A browser into a pod**, once §7 is decided.
8. **A live run.** A hosted Stadeum box with pods for the `hive`
   workspace:
   - a push to `stable` goes in at the next upkeep window, and not before;
   - a job claims a pod, runs the tests, and leaves its changes
     uncommitted;
   - the pod sleeps, and a turn hours later finds it as it was;
   - after 8 hours, a turn finds it rolled over, with its changes;
   - the job opens a PR.

## 14. Open

1. A person's browser and strut's browser steps opening a pod (§7).
2. Whether compose's services come up during the image build and survive
   in the snapshot, and what DNS the containers need.
3. Whether `terminate` runs for a suspended MicroVM that expires, and how
   long it gets.
4. Whether 32 GB of disk is enough for a real workspace, and whether the
   endpoint's limits make a dev server slow.
5. How long an image build takes, and whether 5 builds at once is enough
   for the nightly run on a box with many workspaces.
