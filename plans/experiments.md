# Experiments: a change to the pages, tested, whoever made it

> **Status (2026-11-23): a plan.** Strut does this today for one page at
> a time, from an admin's Knowledge app. A change of any size, the tab,
> and Jamie doing it from a prompt are not built.
>
> **The goal (owner, 2026-11-23):** *"an Experiments tab in the Knowledge
> app that generates a bunch of cases for you and runs them all the way
> through."* The first use: *"jamie picks a bunch of repos to use (some
> yours, some common, mix of languages) and does them all and optimizes
> the Pods and Pod Setup concepts based on real trials, then tries again
> - not just changing one thing at a time, but being intelligent enough
> to make a bunch of changes and guiding real evolution"*, toward *"the
> MOST USABLE output - the thing that feels the most real to the human
> (no dead links.. stub and mock if needed!!!! which could include mock
> data prs directly if needed!)"*.
>
> **Generic (owner, the same day):** *"a generic simple solution that
> will work for any hillclimbing on concepts later (legal benchmarks,
> coding benchmarks, anything)"*. *"ideas like 'pods' or 'jamie picking
> repositories' should JUST BE IN A PROMPT! Thats what i mean by GENERIC
> - no specific logic about how or why an experiemnt runs."* *"Why does
> it matter whether a human or jamie did it? Cant it be the same UI?
> Whats the simplest possible flexible unconstrained way?"*
>
> Only the quoted words are the owner's. The rest is proposed. Read
> against strut `main` @07101d4b and stakwork/pods `main` @95d6c37.
>
> **Earlier (2026-11-21):** the owner wanted pods to make it as easy for
> Jamie to try things as it is for an agent on a laptop, and once
> Software is built *"we'll run some experiments to optimize it"*, from
> the Knowledge app, as claims on the pods pages. The owner also asked
> for one design that judges a deliverable, a model guessing the right
> setup, and questions about a company's own infrastructure, *"REALLY
> simple and flexible"*, for *"future things we haven't even thought of
> yet"*.
>
> Earlier drafts had kinds of case, rounds, limits and a rule for
> keeping a change. They are gone: this file's history has them.

## The design

Three things, all strut's already:

| | |
| --- | --- |
| A **case** | Something to run: an input to a workflow |
| A **claim** | A sentence the result must make true, with a check that judges it |
| A **change** | A diff of the pages: any number edited, added or removed |

An **experiment** is one change, run on some cases, with what the claims
said with it and without it. That is the whole record: the diff, the
cases, each side's verdicts, and what each run took and cost.

Strut knows nothing more about one:

- **No goal, round, limit or score in code.** Nothing decides. Whoever
  ran it reads the verdicts and uses the change or doesn't.
- **A climb is experiments in a row,** each starting from the best so
  far. Whoever runs it picks the next.
- **Everything else is a prompt:** where the cases come from, how many,
  what to change, how many things at once, when to stop.

**A prompt is** a person's message, and pages. The subject's own pages
say what the work is (`Pod Setup`). One page, `Experiment`, says how to
experiment well: read every failure before changing anything, make every
change the reading supports, keep some cases back, never reword a claim
to pass it, stop when it stops improving. It is a page, so it has claims
of its own and can be experimented on.

**A person and Jamie are the same.** Each adds a case, adds a claim,
tests a change and uses it, through the same steps. The record says who.
Asking Jamie is one more way to press the same buttons.

## The tab

Every experiment, newest first, a person's and Jamie's drawn alike. The
numbers are made up.

```text
Experiments                  [ What should get better?                ]

  Pod setup feels real                                  Jamie · today
    Seed data, and a stub for each outside service        3 pages
      With it      71 of 90   22 min   $0.49 a run
      Without it   52 of 90   27 min   $0.58 a run        [Use it]
    A page for each stack                                 5 pages
      With it      64 of 90   24 min   $0.55 a run
      Without it   71 of 90   22 min   $0.49 a run

  Orchestrator                                       Dana · 2 days ago
    Says what its jobs can do                             1 page
      With it       8 of 8
      Without it    0 of 8                                [Use it]
```

- **The box** starts a Jamie chat with the message as its first turn.
  The experiments that chat makes are listed under its title.
- **By hand** is what the Knowledge app has today: open a page, Try a
  change, Test it. It lands in the same list.
- **A row opens** as a page's test does today: the diff, the verdicts by
  claim and by case, and each sample (the message, the reply, what it
  took and cost, the judge's line).
- **Use it** puts the change on the pages, as today.

## What strut needs

| What | Today |
| --- | --- |
| **A change of any size.** A test takes a diff of the tree, and either side can start from an earlier test's change | `test` takes one page's new wording against the page as it is |
| **The same steps for Jamie:** `knowledge/checks`, `add-check`, `cases`, `trial`, `test`, `use` and `sample` as tools of a job an admin started, which is told when a test's last sample is judged | They answer only strut's own page shown to an admin: "a trial spends, and a page's words are an agent's rules" (open question 1). A trial's end wakes nothing |
| **Every test in one view,** grouped by the chat that made it, with the box | A page's card lists that page's tests |
| **As many cases as a benchmark has** | At most 20 on a claim |
| **The `Experiment` page,** under `Job` | Not there |

That is all. No new kind of node, no workflow of its own, and nothing in
stadeum: the tab is in strut's Knowledge app, framed as any app is
(rule 1).

Already built, and used as it is:

- claims on a page, cases, trials, and a test of one page's wording;
- a case that runs as a job of its own, closed once it is judged;
- each run's time and cost beside its verdicts;
- a check that is any step, so it can look at the world;
- Concept branches, which a test's changed side runs on;
- a package's pages carrying their claims and checks.

## Everything else is a prompt

| | What the person says | What judges it |
| --- | --- | --- |
| **Pods setup** | "Pick ten repositories: some of mine, some common ones, a mix of languages. Set each one up. Improve `Pod` and `Pod Setup` from what went wrong, many changes at once, and try again until it stops getting better." | The claims on `Pod Setup`, which the pods package ships |
| **A benchmark** | "Load the tasks in this repository as cases. Improve the pages under `Contracts` until the score stops rising. Keep a fifth of the tasks back and score them at the end." | One claim, "The answer matches the task's", whose check is the benchmark's grader |
| **Knowing without trying** | "Ask twenty questions about what common stacks need to run, and fix the pages that got them wrong." | A claim for each fact: "It names Postgres, Redis and a worker" |
| **Our own infrastructure** | "Ask about how staging is set up, and fix what the pages get wrong." | A claim for each fact |
| **One line of one page** | Nothing. A person presses Try a change | The page's claims |

The answer to a case is a claim's sentence, or something its check
knows. The run sees neither: it is handed the page, never its claims.

### What the pods example needs

None of it is strut's. It is the pods package's pages and steps.

- **"Most usable" as claims** on `Pod Setup`. Four are there: it bakes,
  a person gets in, it asked for no secret, and the workspace's page is
  written. Three more:
  - **No dead ends.** Every link and button the test user can reach
    leads to a page that works.
  - **It has something in it.** Lists have rows, and a record opens.
  - **Everything outside is stood in for,** by a stub or a mock in the
    pod.
- **A check that follows every link,** for "No dead ends": a step, as
  `stadeum/pods/baked` is one.
- **Mock data in the repository itself.** The owner: stubbing *"could
  include mock data prs directly if needed"*. Read here as pull requests
  that add seed data or stubs to a repository, opened by the setup
  without asking (open question 2). `Pod Setup` would say so. In a
  trial, pods already holds the push and shows the judge what it would
  have sent.
- **`claim` asks strut for a model key,** for an app that calls a model.
  Strut's grant is built. `claim` doesn't ask yet.
- **A trial leaves nothing behind.** Built: a workspace of the sample's
  own, its images deleted with it, its page a file of the job.

One setup takes about 25 minutes and $0.65 with its pod, so thirty are
about $20. What to spend is in the prompt.

## Later

Each is the same steps, used by something else:

- **The dream writes cases.** When a person corrects the model, the
  dream writes the lesson on a page and the fact as a claim. With the
  question as a case, the fact can't quietly fall out of the pages.
- **Finished jobs as a dream source,** beside conversations: what a
  setup that baked found to work, how a plan's questions were ruled.
- **A claim judged only on its own cases.** A page of 30 facts costs 30
  judge calls after each edit today, because the Knowledge app sets no
  policy on a claim.

## Open questions

1. **Jamie holding these steps.** Strut keeps them to an admin's own
   page because a trial spends and a page's words are an agent's rules.
   Proposed: a job an admin starts from the tab holds them, and acts as
   that admin. Or any job of an admin's?
2. **"Mock data prs."** Pull requests that add seed data or stubs to a
   repository, as read above? Or made-up pull requests as data, for an
   app that shows them?
3. **Jamie and the claims.** With the same steps, Jamie can add a claim,
   as a person can. The `Experiment` page says never to reword one to
   pass it, and the record says who wrote each. Is that enough?
4. **Spending.** The limit is in the prompt. The one hard stop is the
   person's spending cap at the gateway. Is that enough for a climb left
   running overnight?
5. **A package's pages.** Strut never changes a package's page in the
   graph. Use it writes into a checkout of the package where the box has
   one, and is refused where it doesn't. The pods package's source is
   `package/` in stakwork/pods, and boxes follow a published copy. So
   where does a climb on `Pod Setup` land?
6. **What a question runs on.** A case that only asks something needs a
   workflow that answers in one run. The orchestrator sends what it must
   find out to a job, and a trial holds jobs.
