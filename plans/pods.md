# Pods: what Stadeum does for them

> **Status (2026-11-18): proposed. Nothing is built.** The plan for pods
> moved to the repository that builds them, `stakwork/pods`, as its
> `PLAN.md`, rewritten after the owner's review on 2026-11-18. This file
> keeps only Stadeum's part. Its earlier version (stakwork/stadeum#52 to
> #54) is in git history.

A pod is a machine of its own for one coding job. It runs the job's stack
(docker compose for services, pm2 for the apps being developed), and it
serves each app over HTTPS. Pods reach strut as a package, `stadeum/pods`,
whose steps call a pods service that holds the cloud keys. Stadeum knows
no pod (rule 1). Its part is the subscription and, later, a container.

## What Stadeum does

- **The subscription.** ops subscribes the box at first boot, with the
  deployment key:
  `PUT /packages/subscriptions/pods { "ref": "git+https://github.com/stakwork/pods@stable#package" }`.
  The packages a box follows are listed in ops's image, so a release can
  add one to every box. This starts once `stakwork/pods` is public.
- **When it moves.** Strut runs with `STRUT_DISTRO_POLL_MINUTES=0`. Each
  night in the upkeep window, after strut's image, ops calls
  `POST /packages/subscriptions/pods/sync` and records the commits from
  and to, as it records an image's. A sync that fails keeps what's
  installed, and ops records why.
- **The secrets.** Strut installs nothing of the package until
  `PODS_URL` and `PODS_TOKEN` are set. Stakwork sets them on the boxes it
  hosts, each a tenant of Stakwork's pods service. Rule 4 names
  `PODS_TOKEN` among what strut holds once pods ship: it reaches only the
  box's own pods, and it's accepted as the treasury's pay token is.
- **`scripts/promote.sh pods`** runs the pods repository's promote.
- **Backups.** Pods aren't in the box's backup (rule 8). Pushed work is in
  GitHub, and what jobs learned is in strut's graph.

## Later, for self-hosted boxes

The box runs the pods service's image as an optional container, `pods`,
with its own account's keys, as it runs the treasury's image. Its volume
is in the backup. It moves in strut's update group, and it waits without
its settings. It needs its names in the Caddyfile (a wildcard certificate
needs a DNS-01 challenge), and the Packages page must show a waiting
subscription and the secrets it needs.
