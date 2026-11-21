# Experiments: a workspace a person can click through

> **Status (2026-11-21): a plan, nothing built.** The owner's goal: pods
> make it as easy for Jamie to try things as it is for an agent on a
> laptop, *"spinning up new workspaces all the time, they can be stored
> or ephemeral"*, and once Software is built *"we'll run some
> experiments to optimize it"*, from the Knowledge app, as claims on the
> pods pages. The first: *"take a repo or set of repos and set them up
> fully, so the user can actually click through"*. All of this is
> *proposed*. Read against strut `main` @b28dfa6e and stakwork/pods
> `main` @556d080.
>
> **2026-11-21:** the owner decided that a setup leaves one page for the
> workspace: a diagram of its systems and how they connect, the system in
> words, and how to run it. The bake writes it, so an ephemeral workspace
> leaves none (`plans/software.md` §14.2). Claim 4 reads it.

## The idea

An experiment needs no framework of its own. Strut's Knowledge app
already has every part, and a different experiment is a different page,
its claims and its cases.

| An experiment's | Is strut's | Today |
| --- | --- | --- |
| What "good" means | A **claim** on a page, with a check. It judges every piece of work that opened the page | Built |
| What it is tried on | The claim's **cases**, each `{ workflow, input }`, up to 20 | Built |
| One go at it | A **trial**: n samples of each case, four at a time | Built, from an admin's Knowledge app |
| A change to try | A **test**: the page as it is against the page with a change, on the same cases | Built, for a page's wording |
| What it cost | Each run's own summary: time, tokens, cost | Recorded, not shown beside the verdicts |

## Experiment 1: set a workspace up

**The page.** `Pod Setup`, a kind under `Job`, split out of today's
`Pod` page: getting a repository's app running for the first time, up to
the bake, which writes the workspace's page (`plans/software.md` §14.2).
`Pod` keeps working in a pod that is already set up. Claims on
`Pod Setup` then judge setup work alone, whichever job did it.

**The cases.** Six to ten workspaces, each a job of kind `Pod Setup`
with one sentence: "Set up `<these repositories>` so a person can click
through." Ours first, because we know what right looks like, then others
so the page isn't fitted to our stacks:

- one repository we have a baseline for (hive: 28 minutes and $0.31 the
  first time, by hand-written prompt);
- one that needs a stub (object storage, mail);
- one whose app calls a model, so it needs a key from the gateway;
- one workspace of several repositories;
- two or three public apps on stacks we don't use.

Each is pinned to a commit, so two runs set up the same code.

**The claims.** Four, each a sentence a person would agree with:

| Claim | How it is checked |
| --- | --- |
| **It bakes.** The workspace has a ready image this work made | Read from the pods service. A bake succeeds only when `pod check`, with the repository's own `check.sh`, passes in the build and again on a machine started from the image, so this also proves a fresh pod comes up |
| **A person can click through.** From that image, a signed-out browser reaches the app, signs in as the test user and opens the pages a person would use, with no error page | Strut's own browser against the pod's link, never the agent's word |
| **Nothing real was asked for.** It used stubs and the gateway's model key, asked the person for no secret, and wrote none into a file | A model reads the work |
| **The next job starts from it.** `.pod/` is on a branch, and the workspace's page draws each of its systems and each connection between them, says how they fit together, and says how to run them: the services, ports, test user and what broke | A model reads the work |

Time and cost are not claims. They are read from each run's summary and
shown beside the verdicts, so a change that passes as often but takes
half as long is visible.

**One sample.** A job of its own starts with a bare pod in a workspace of
its own, so it never reuses or replaces a real workspace's image. The
agent works as the `Pod Setup` page says. When it ends, the checks run,
the verdicts are recorded on the claims, and the pod, its image and its
workspace's page go.

**The loop.**

1. Run every case three times on the page as it is. That is the
   baseline: how often each claim holds, how long, how much.
2. Read what failed. Make one change to the page.
3. Test the change against the page on the same cases. Keep it if it
   does better.
4. When the easy cases hold, add harder ones.

## What has to be built

The smallest list that makes the loop run. Everything else waits.

| Where | What | Why |
| --- | --- | --- |
| strut | **A trial's case can be a job** (`plans/software.md` §5, item 13): it gets a job of its own, with its holds, released once the sample is judged | A trial starts no job today, and a run with no job has no pod |
| strut | **Each side's time and cost beside its verdicts,** from the runs' own summaries | A check says yes or no, never a number |
| pods | **The `Pod Setup` page,** split from `Pod`, ending at the bake, which writes the workspace's page | Claims on setup alone, and claim 4 reads what it leaves |
| pods | **`claim` asks strut for a model key** and sets it in the pod | An app that calls a model. Strut's grant is built; `claim` doesn't ask yet |
| pods | **A sample's workspace is its own,** and its images and its page are deleted with it | An experiment must not replace a team's real image, or leave its page in the tree |

Not needed for the first run, and each is generic when it comes:

- **A package's claims recorded at install** (item 12). Until then an
  admin adds the four claims and the cases in the Knowledge app, once.
- **A number on a verdict.** A benchmark (an API's speed, a local speech
  model) wants one. Setup doesn't.
- **A trial started by a schedule or over HTTP.** A person presses the
  button for now.
- **Several pods at once,** and a pod kept or forked while it runs
  (`plans/software.md`, "Later").
- **The diagram drawn** in the Knowledge app (`plans/software.md` §5,
  item 23). The checks and the next job read its text.

## What makes it general

- **Another experiment is another page.** A benchmark is a kind of job
  with its own claims and cases. Nothing above names setup.
- **A stronger check drops in.** A journey written once for a case (a
  script that walks to a screen) can replace the browser's generic walk
  when that proves too soft.
- **Anything a page can say can be tested.** The first changes are to the
  page's wording. A different model or pod size is the same comparison,
  once a test can change more than a page.
- **The workspace's page is measured the same way.** A setup case that
  starts from a workspace's page, tested on the page as it is against
  the page left empty, says what the page is worth in minutes and
  dollars.

## Open questions

1. **The click-through check.** One generic walk for every case (sign in
   as the test user named on the workspace's page, open three pages), or
   a journey we write once for each case? The first is no work and may
   be too easy to pass. The second is the truth and costs a script each.
2. **A failed sample's pod.** Released at once, or kept an hour so a
   person can look? Pods cost about $0.25 to $0.50 an hour.
3. **Which repositories.** The owner's to pick.
4. **A cap for one sample.** A setup that never finishes should stop:
   suggest 45 minutes and $2, against hive's 28 minutes and $0.31.
5. **A sample's page while it runs.** A trial's runs write to main's
   graph (only a test's changed side runs on a Concept branch), so a
   sample's workspace page is in the tree until the sample goes.
   Deleting it then is enough to start. Running every sample on a
   throwaway branch is cleaner, and a change to strut.
