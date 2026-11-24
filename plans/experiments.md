# Experiments: Jamie makes the cases, runs them and improves the pages

> **Status (2026-11-23): a plan. The parts to run Experiment 1 by hand
> are built. The Experiments tab, and the loop that runs itself, are
> not.**
>
> **The goal (owner, 2026-11-23):** *"an Experiments tab in the Knowledge
> app that generates a bunch of cases for you and runs them all the way
> through."* The first is the pods setup: *"jamie picks a bunch of repos
> to use (some yours, some common, mix of languages) and does them all
> and optimizes the Pods and Pod Setup concepts based on real trials,
> then tries again - not just changing one thing at a time, but being
> intelligent enough to make a bunch of changes and guiding real
> evolution"*. What it aims at: *"the MOST USABLE output - the thing that
> feels the most real to the human (no dead links.. stub and mock if
> needed!!!! which could include mock data prs directly if needed!)"*.
>
> Only the quoted words are the owner's. The rest is proposed. Read
> against strut `main` @07101d4b and stakwork/pods `main` @95d6c37.
>
> **Earlier (2026-11-21):** the owner wanted pods to make it as easy for
> Jamie to try things as it is for an agent on a laptop, *"spinning up
> new workspaces all the time, they can be stored or ephemeral"*, and
> once Software is built *"we'll run some experiments to optimize it"*,
> from the Knowledge app, as claims on the pods pages. The first: *"take
> a repo or set of repos and set them up fully, so the user can actually
> click through"*. The same day the owner decided that a setup leaves one
> page for the workspace (`plans/software.md` §14.2), and asked how one
> design covers a deliverable, a model guessing the right setup, and a
> company's own infrastructure ("Kinds of case").
>
> **Built since:** a trial's case runs as a job of its own, with its time
> and cost. A package's pages carry their claims. `Pod Setup` is a page
> of its own with four claims. A pod in a trial leaves nothing behind.
> "What is built" lists them.

## The goal

A person says what should get better. Jamie makes the cases, runs every
one all the way through, reads what happened, changes the pages, and
runs them again, round after round, up to a limit the person set. The
person reads what changed and what it did, and uses it or not.

An experiment needs no framework of its own. Strut has the parts:
claims, cases, trials and Concept branches. What is missing is the loop
that drives them, and the tab. Stadeum builds nothing: the tab is in
strut's Knowledge app, framed as any app is, and stadeum knows no
experiment (rule 1).

## An experiment, in strut's words

| An experiment's | Is strut's | Today |
| --- | --- | --- |
| Goal | A sentence, and the pages it may change: a page and the pages under it | Not built |
| What "good" means | **Claims** on those pages, each with a check. A claim judges every piece of work that opened its page | Built |
| What it is tried on | **Cases**, each `{ workflow, input }`, up to 20 on a claim | Built. A person writes them |
| One go at a case | A **sample**: a fresh run, or a job of its own, judged by every claim the case tests, with what it took and cost | Built |
| A set of changes to try | A **Concept branch**: a copy of the tree with any number of pages changed, added or removed. A run can be launched on it, and main's claims judge it there | Built |
| A round | Every case run on the branch, set against the best round so far | Not built. A trial runs on main, and a test changes one page's wording |
| Using what won | `knowledge/merge`. For a page that comes from a package, a change in the package's repository | Built, with no view |

Another experiment is another goal and other pages. Nothing above names
setup.

## A round

1. **Run** every case, a few samples of each, four at a time. The first
   time this is on the pages as they are: the start.
2. **Read** all of it. Every sample that failed, whole: what the agent
   did, where the time went, the recording, the judge's line. And the
   ones that passed, for what was slow or dear.
3. **Change** the pages on the experiment's branch. One round carries
   every change the reading supports: a rule reworded, a section moved
   up, a new page under `Pod Setup` for one kind of stack, lines taken
   out. Each change says which samples it answers.
4. **Run** every case again, on the branch.
5. **Compare** the round with the best so far: each claim, each case,
   time and cost.
6. **Keep it,** when more holds. A tie goes to the round that took less
   time and money. Otherwise the pages go back to the best round's text,
   and the round stays on the record with what it tried.
7. **Again,** until the limit, or until two rounds in a row keep
   nothing.

### Many changes at once

The owner: *"not just changing one thing at a time"*. A setup sample
takes about 25 minutes, so a round of 30 takes hours. Six changes tested
one by one are six rounds. Tested together they are one.

A round is compared case by case and claim by claim, so a round that
did worse still says where: "Has data" rose on every case and "Bakes"
fell on the two Java ones. The next round keeps what helped and drops
what hurt. That is the judgment asked of Jamie.

Proving one part on its own stays possible afterwards. It is the
Knowledge app's test, built: take the lines out of the page and run the
cases again.

### What keeps it honest

- **The measure is not the candidate.** An experiment changes pages,
  never a claim or a check. The claims are the same on main and on its
  branch (strut `plans/concept-evals.md`, ruling 4).
- **The checks look at the world:** the pods service, and strut's own
  browser on the pod's link. Never the agent's word that it worked.
- **New cases every round.** Jamie adds a few repositories the pages
  were never tried on, so the pages don't get fitted to the ones he
  started with.
- **A general page names no case.** `Pod Setup` may say what a Rails app
  needs, never what one repository needs. That goes on the workspace's
  own page, which a sample throws away.
- **Main doesn't move while it runs.** Real jobs keep reading the pages
  as they were until a person uses the result.
- **Setups vary.** A case run once proves little, so every side gets
  several samples of each case.

## Most usable

The owner: the aim is *"the MOST USABLE output - the thing that feels
the most real to the human"*. As claims, each a sentence a person would
agree with:

| Claim | How it is checked | Today |
| --- | --- | --- |
| **It bakes.** The work leaves a ready image of the workspace, baked by this work | `stadeum/pods/baked` asks the pods service. A bake succeeds only when `pod check` passes in the build and again on a machine started from the image | On `Pod Setup` |
| **A person gets in.** From that image, a signed-out browser gets into each app from the job's links, signs in as the test user and opens the pages a person would use | A model reads the work and its recordings | On `Pod Setup` |
| **No dead ends.** Every link, tab and button the test user can reach within three clicks of the first page leads to a page that works: no error page, no "not found", no blank page, no spinner that never stops | Strut's own browser, signed in on the job's pod, follows each one and lists the dead ones | New. Needs the crawl |
| **It has something in it.** Lists have rows, dashboards have numbers, and a record opens: seeded or made up, never an empty app | A model looks at the pages the crawl opened | New |
| **Everything outside is stood in for.** Each outside service a page needs (a sign-in provider, payments, mail, storage, another team's API) is answered by a stub or a mock in the pod, and a model call by the gateway's key | A model reads the work and the workspace's page, where each arrow that leaves the pod says what answers it | New |
| **Nothing real was asked for.** It asked the person for no secret and wrote none into a file | A model reads the work | On `Pod Setup` |
| **The next job starts from it.** The workspace's page draws each system and each connection, says how they fit together and how to run them, and which repositories run in the pod and which are only source | A model reads the work | On `Pod Setup` |

Time and cost are not claims. They are read from each run's summary and
shown beside the verdicts, so a round that holds as often in half the
time shows.

**Mock data in the repository itself.** The owner: stubbing and mocking
*"could include mock data prs directly if needed"*. Read here as: when
feeling real needs a change to a repository's own code (seed data, a
sign-in for development, a switch that points a client at a stub), the
setup makes it and opens a pull request on that repository, without
asking first. Proposed, to go with that:

- Until the pull request merges, the change is also in `.pod/`, applied
  by `setup.sh`. A bake starts from the repositories and
  `/workspaces/.pod` alone, so the image has it either way.
- A public repository that isn't the person's gets the copy in `.pod/`
  and no pull request.
- In an experiment nothing is pushed. Pods' `git` holds a trial's push
  and hands the judge what it would have sent. This is built.

## Experiment 1: the pods setup

**The pages.** `Pod` and `Pod Setup`, which the pods package ships, and
any page the experiment adds under them.

**The cases.** Jamie picks about ten workspaces. Each is a job of kind
`Pod Setup` with one sentence: "Set up `<these repositories>` so a
person can click through." Each repository is pinned to a commit, so
two rounds set up the same code. The owner's mix: *"some yours, some
common, mix of languages"*.

- **Yours:** from what the person's own token reaches
  (`git/repositories`), most recently pushed first. One the box already
  has a workspace for is the best check, since we know what right looks
  like (hive: 28 minutes and $0.31 by a hand-written prompt, about 20
  minutes and $0.66 by the first real Set Up).
- **Common:** public apps with a sign-in and pages to click through, on
  stacks we don't use: Rails, Django, Laravel, Phoenix, Go, Spring.
- **Across shapes,** whatever the language:
  - a workspace of several repositories that call each other;
  - one that needs a stub (object storage, mail, payments);
  - one that signs in through a provider;
  - one whose app calls a model;
  - one with a repository that can't run in a pod (a phone app), which
    stays source.

**One sample.** Built, in the pods package. A job of its own starts with
a bare pod in a workspace of its own, so it never reuses or replaces a
real workspace's image. Its push is held. Its workspace page goes to a
file of the job, for the judge, and never to the graph. Once it is
judged, strut closes the job, and the pod and its images go.

**What a round costs.** Ten cases, three samples each, is 30 setups. At
about 25 minutes and $0.65 each with the pod, that is about $20, and
three hours at four at a time. Five rounds and the start: about $120
and most of a day. An estimate from two real setups.

**What a page can't fix.** Some of what a round finds is not wording:
`pod survey` missed a stack, the base image lacks a tool, nobody has a
stub for a service. The round lists these for a person. The experiment
changes pages alone.

**Where it lands.** `Pod` and `Pod Setup` come from the pods package,
and strut never changes a package's page in the graph. The package is
written in stakwork/pods, under `package/concepts/`, and published from
there to stakwork/strut-pods, which every box with Software follows. So
using Experiment 1's result is a pull request on stakwork/pods (open
question 4).

## The Experiments tab

A fourth view over the Knowledge app's graph, beside Waiting, Changes
and Learned. An admin's, as trials are. The numbers below are made up.

```text
Experiments                                                     [New]

  Pod setup    round 3 of 5 · 7 of 30 running · $58 of $150
    Goal    A person can click through the workspace, and it feels real
    Pages   Pod, Pod Setup
    Cases   10 workspaces: 4 yours, 6 public · 2 new each round

            Bakes  Gets in  No dead ends  Has data  Stubbed   A run
    Start   24/30  19/30     6/30         11/30     14/30     27 min  $0.58
    1       28/30  25/30    17/30         18/30     22/30     22 min  $0.49   kept · 6 changes
    2       26/30  21/30    20/30         17/30     23/30     24 min  $0.55   put back · 4 changes
    3       running

    [What changed]   [Use it]   [Stop]
```

- **New** asks for three things: the goal in a sentence, the page it is
  about, and a limit in rounds and dollars.
- **It starts in a Jamie chat,** with the experiment already running, as
  Set up does (`conversation/start`). Jamie says which cases he picked
  and which claims judge him, and goes. The person changes either in
  words ("skip the Java ones"). The owner (2026-11-23): *"THE JAMIE CHAT
  IS THE BEST UI FOR ALMOST EVERYTHING."*
- **So an experiment is a job,** of kind `Experiment`. Its page under
  `Job` holds the rules: how to pick cases, how to read a round, how to
  write a round's changes. The rules are a page, so they carry claims
  and can be measured as any page's are.
- **A round opens** to its cases by claim. Each sample is a dot that
  opens as a trial's sample does today: the message, the reply, the
  recording, what it took and cost, the judge's line. The round's
  changes are one diff, each with the samples it answers.
- **What changed** is main against the experiment's branch. **Use it**
  lands it.
- **Where a page has no claim that says the goal,** Jamie proposes the
  claims and a person accepts each. Experiment 1's come with the pods
  package.

## What is built

With these, Experiment 1 can be run by hand, one page and one change at
a time: in the Knowledge app an admin opens `Pod Setup`, adds the cases,
runs them, tries a change and tests it.

| Where | What |
| --- | --- |
| strut | A trial's case of a job's workflow runs as a job of its own, closed once the sample is judged, so a pod it held is let go |
| strut | Each sample's time and cost beside its verdicts |
| strut | A package's pages' claims, recorded at install, with a check that is the package's own step |
| strut | Concept branches: runs launched on one, main's claims judging them there, the compare, the merge |
| strut | `git/repositories`, `conversation/start`, and a page's `mermaid` block drawn |
| pods | `Pod Setup`, split from `Pod`, with four claims. The bake writes the workspace's page |
| pods | In a trial: a workspace of the sample's own, its images deleted with it, its page a file of the job, its push held |

## What has to be built

All of strut's are generic: none names setup.

| Where | What | Today |
| --- | --- | --- |
| strut | **A trial a job starts,** on main or on a Concept branch, that wakes the job when its last sample is judged | `knowledge/trial` takes a claim and a count, runs on main, and answers only strut's own page shown to an admin. A trial's end wakes nothing |
| strut | **A round's verdicts read together:** every claim and case of one round, with time and cost, set against another round | Verdicts are counted by one page's wording. `knowledge/compare` sets main against a branch as each reads now |
| strut | **Part of the Knowledge door for an experiment's job:** page writes on its own branch alone, cases, trials and the compare. Never a claim or a check | The dream is the one workflow that holds the door, and `knowledge/cases` is an admin's page's |
| strut | **The experiment kept:** its goal, pages, limit, branch and rounds, each round with its changes and their reasons | A test is kept as a file. Nothing holds a series |
| strut | **The `Experiment` page** under `Job`, and its claims | Not there |
| strut | **The Experiments tab,** with a view of the compare and of Use it | The app draws a page's checks and tests. The compare and the merge have no view |
| strut | **A crawl as a check:** from a link, signed in, every link to a depth, each dead one listed | `browser/verify` and `browser/walkthrough` test a path someone wrote |
| strut | **A limit an experiment can't pass:** rounds and dollars for the whole, minutes and dollars for one sample (open question 9) | A person's spending cap at the gateway stops all of their work. Nothing caps one experiment or one sample |
| pods | **The three new claims** in `Pod Setup`'s `claims:` block | Four claims |
| pods | **`claim` asks strut for a model key** and sets it in the pod | Strut's grant is built. `claim` doesn't ask yet |

Each of these waits, and is generic when it comes:

- **A number on a verdict.** A benchmark (an API's speed, a local speech
  model) wants one. Setup doesn't.
- **An experiment on a schedule.** A person presses New for now.
- **More than a page can say.** A different model or pod size is the
  same comparison, once a round can change more than pages.
- **Journeys.** A script written once for a case, walking to a screen
  (`plans/software.md`, "Later"), can replace the crawl where it proves
  too soft.

## Kinds of case

The owner (2026-11-21): an experiment should *"judge the outcome
(deliverable, like a running pod)"*, but also *"the concepts SHOULD get
good enough that the model can 'guess' at the proper configuration"*,
and *"you could create tests about your own company's infra"*. All of
it *"REALLY simple and flexible"*, for *"future things we haven't even
thought of yet"*.

Strut has one shape for all of these. A **case** is an input to a
workflow. A **claim** is a sentence its result must make true. A
**check** is how that is judged. The `Orchestrator` page works this way
today: its case `Can you use bash?` runs the `orchestrator` workflow,
and its two claims say what the reply must do
(strut `src/concepts/Orchestrator.md`).

What looks like different kinds of case differs on three settings, none
of them new:

| Setting | Choices | Built? |
| --- | --- | --- |
| What the case runs | The real work (a job that sets up a pod), or a question asked of a workflow | Both |
| When its claim is judged | **Standing:** every real work that opens the page (policy `always`, `on_change` or `sample`). **Exam:** only its own cases (`manual`) | Yes. But the Knowledge app sets no policy, and a page's `claims:` block sets one only on a check it names: the standard check gets `on_change` |
| What the check looks at | The work's own answer against the claim's sentence (strut's standard judge), or the world (the pods service, strut's browser on the pod's link) | Both |

So the kinds the owner named are:

- **The deliverable.** The case: "Set up hive so a person can click
  through", a job. The claims: "Most usable", standing, checked against
  the world. Experiment 1.
- **Knowing without trying.** The case: "What does a Rails app with
  Sidekiq need running beside it?" The claim: "It names Postgres, Redis
  and a worker process beside the web one." An exam claim. Time and
  cost tell whether the pages knew: good pages give the right answer in
  seconds for cents, and thin ones guess wrong or start digging.
- **A company's own infrastructure.** The case: "Which box serves
  staging's gateway?" The claim: the answer, as a sentence. An exam
  claim, on that company's pages.

**The answer is in the claim, one sentence per fact,** not an expected
answer kept on the case:

- it needs no new field;
- the run never sees a page's claims (`graph/graph-get` and
  `context/concept` hand it the page alone), so the answer can't leak;
- each fact has its own verdicts in the Knowledge app, so each part of a
  page is proved on its own.

**Where cases come from.**

- **A person,** in the Knowledge app. Built.
- **Jamie, for an experiment:** repositories to set up, or questions to
  ask ("Experiment 1", above).
- **The dream,** from any source it reads. Today it reads one,
  conversations: when a person corrects the model ("we use pnpm here"),
  it writes the lesson on a page. The second is **finished jobs**, of
  any kind: a setup, a plan, a code item, a workflow the builder made.
  What a person said in one is a correction; a plan's `plan.md` holds
  its questions and how each was ruled (Decided) and what each item did
  differently (Progress); a setup that bakes holds what worked ("hive
  runs Postgres 16 and Redis 7, the API on 3333"). From either source
  the dream writes the lesson on a page and the fact as an exam claim,
  with the question as its case, so the fact can't quietly fall out of
  the pages again. The dear loop writes the cheap loop's questions.

**Two loops.** Exam cases are cheap: dozens on a page, run on every
change to its wording. Deliverable cases are dear (half an hour and
about $0.65 each): a few, to confirm what the cheap loop found. If exam
verdicts improve and setups get no faster or surer, the exam measures
the wrong thing.

**Anything new** is a new workflow (how a case runs) or a new check (how
it is judged). Anyone can write both today, so claims, cases, trials and
tests stay as they are.

**What exam claims need from strut.** None is needed for Experiment 1:

- **A claim's policy,** from the Knowledge app and for the standard
  check in a page's `claims:` block. With `on_change`, a page of 30
  facts costs 30 judge calls after each edit, most of them answering
  that the fact isn't about the work in front of them.
- **The dream adds a case** to a claim it writes. Today only an admin's
  page sets cases.
- **Finished jobs as a dream source.** The dream already takes a source
  by name (strut `src/concepts/Dream.md`: one page per kind of source
  under `Dream`, `input.source` on its workflow), and only `Assistant
  Conversations` is built. A second is a page under `Dream` and a step
  that hands over each finished job: its kind and brief, what the person
  said to it, its deliverables (the job index has them: `plan.md`, pull
  requests, published workflows) and its claims' verdicts. What the
  dream does with it (claim, evidence, change) is unchanged: a job's
  turn is a run, and evidence on it is built.

## Open questions

1. **"Mock data prs."** Read above as pull requests that add seed data
   or stubs to a repository, opened by the setup without asking. The
   other reading: made-up pull requests as data, for an app that shows
   them. Which did the owner mean?
2. **When a round is better.** More verdicts hold, over every claim and
   case, and a tie goes to less time and money. With 30 samples a side,
   a few either way is chance. Count with a lower bound (strut
   `plans/claim-trials.md` item 2, not built), or run the cases that
   moved again?
3. **Who uses the result.** A person, once, at the end (proposed). Or
   the experiment itself, when a round holds: the dream changes main by
   itself, and strut merges nothing on a score today.
4. **Where a package's pages land.** Strut writes a change to a
   package's page only into a checkout of the package opened as a
   repository on that box, where its Commit makes the pull request. On
   any other box it skips the page. And stakwork/strut-pods is a
   published copy nothing else writes to: the source is `package/` in
   stakwork/pods. Does Use it hand over the changed files for a person
   to carry there, or open the pull request on the source repository?
5. **A job, or a workflow like the dream.** Proposed: a job of kind
   `Experiment` in a Jamie chat, which a person can steer in words. It
   then holds part of the Knowledge door, which only the dream holds
   now.
6. **The crawl.** How deep, and what it leaves alone: a link out of the
   app, sign out, a button that deletes or sends. Three clicks is a
   guess.
7. **How many new cases a round.** Too few, and the pages get fitted to
   the first ten. Too many, and two rounds can't be compared. Proposed:
   two, and a round is compared on the cases both ran.
8. **A failed sample's pod.** Released at once, or kept an hour so a
   person can look? Pods cost about $0.25 to $0.50 an hour.
9. **A cap for one sample.** A setup that never finishes should stop:
   suggest 45 minutes and $2.
10. **What an exam case runs.** It needs a workflow that answers within
    one run, since a trial holds jobs. The `Orchestrator`'s rules send
    whatever it must find out to a job, so in a trial it may answer only
    that the job is held. The job workflow run without a pod, or a small
    lookup?
11. **A fact's own page gives it away.** If `hive workspace` says
    "Postgres 16", asking about hive measures that page, not whether
    the general pages would have let a model guess. To measure the
    guess, ask about a repository the tree hasn't seen yet, or test
    with that page emptied.
12. **What a finished job counts as.** The `Dream` page learns "only
    from what a person actually said". A plan's question settled by its
    default (the person said only "go"), or a check's verdict on a job,
    is not that. Count them as material, or only what a person said in
    or about the job?
