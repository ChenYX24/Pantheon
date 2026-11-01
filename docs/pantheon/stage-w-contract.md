# Stage W: work says where it stands

**Status: proposed, 2026-11-01. Not implemented.** Like R0, nothing here is
built until the owner approves the report values (§2), the stage table (§3)
and the decisions in §8. Approving them is approving this document;
implementing it is a separate step with its own branch, tests and /dev trial.

## 0. Where this comes from, and what is not taken

`deepseek-ai/dsh-superagent-prototype` (MIT, published 2026-10-31) is a
proactive coding agent for one GitHub repository, built on DeepSeek Harness.
It was read, not run. Its principle is close to this panel's ("every project
reports to me"):

> Take as little human attention as possible, and give as much value as
> possible.

Taken from it:

- **Structured reports.** A worker says one of a few fixed things about its
  work, and a question for a person is a field of its own. The panel never
  infers "waiting on a person" from free text. Today `vibepanel me` has only
  free text (`summary`, `labels`), and that gap is what this stage closes.
- **A stage table where the first matching row wins**, so every session is in
  exactly one stage, and each stage says *whom it waits for and what it needs*.
- **Quiet by default.** A healthy state takes no space. A count equals the
  length of the list it links to. A notification fires on entering a stage
  that needs a person, once.
- **Later, separately approved:** Sources (a GitHub repository, a chat) whose
  events become candidate tasks under a written Policy, and Subscriptions that
  feed a pull request's reviews and CI back to the session that opened it (§6).

Not taken:

- **Its runtime.** It is a DeepSeek Harness bundle with 23 `@deepseek-ai/dsh-*`
  peer packages and DSH's own sessions as executors. Here the sessions are
  Claude Code and Codex in tmux, and the panel does not own their PTYs (red
  line 2). The ideas move; the code does not.
- **Its isolation stance.** Its workers run as the operator and it says so.
  Here a member is a Linux account (stage M), and nothing in this stage
  changes that.
- **A model in the gate.** Its Eval has a model-run assessment. Any first
  version here is deterministic (§6).

## 1. Two axes, kept apart

A session already has a **state** (`internal/session/state.go`: working,
waiting, done and the rest), which says what the *process* is doing, from
hooks or the heuristic. This stage adds a **report**, which says where the
*work* stands, from the session itself. They are different questions:

| | state | report |
|---|---|---|
| Says | is the agent busy at its prompt | does a person need to act |
| Source | hooks, the poller | `vibepanel me report`, `vibepanel me ask` |
| Changes | many times a minute | a few times a task |
| If absent | the heuristic | nothing is claimed (§3, last row) |

Neither is derived from the other. A session at its prompt (`waiting`) may be
`progress` (between steps) or `ready` (done, awaiting review), and only the
session knows which.

## 2. The report

One of six values, validated where it arrives (red line 6):

| Report | Means | Who acts next |
|---|---|---|
| `progress` | working towards the result; nothing needed | the session |
| `waiting` | idle until something outside happens (a run, a reply, a time) | nobody yet |
| `ready` | a result is ready for a person to look at | a person: review |
| `blocked` | cannot go on without a person (access, a decision outside its scope) | a person: unblock |
| `failed` | tried and could not; says why | a person: decide |
| `dropped` | nothing to do (did not reproduce, superseded) | nobody |

Each report carries a one-line `summary` (the existing field) and, for
`ready`, `blocked` and `failed`, it must. A report with no summary where one is
required is refused, because "blocked" with no reason costs a person the
attention of finding out.

A **question** is separate from the report, because a session can ask while
still in `progress`. It carries `text` (one paragraph at most) and up to four
`options`. It is open until a person answers in the session (typed input or a
reply from the chat bridge), or the session withdraws it with `vibepanel me
ask --clear`. At most one question per session is open, and a new one replaces it.

The six values are defined in one place, `internal/session/report.go`. They
are mirrored in `web/src/protocol/wire.ts` and pinned by a test, as red line 3
does for states.

## 3. The stage: first matching row wins

What the panel shows for a session is its **stage**, computed from facts and
never stored:

| # | Stage | Condition | Label (zh / en) |
|---|---|---|---|
| 1 | person / answer | a question is open | 等你回答 / Awaiting answer |
| 2 | person / review | report is `ready` | 等你验收 / Awaiting review |
| 3 | person / unblock | report is `blocked` or `failed`, and no person's input reached the session since | 受阻 · 失败 / Blocked · Failed |
| 4 | handing off | a rollover is in progress (stage R) | 交接中 / Handing off |
| 5 | working | state is `working`, or report is `progress` | 进行中 / Working |
| 6 | idle | report is `waiting` or `dropped`, or the process has ended | 空闲 / Idle |
| 7 | unreported | none of the above | (the state, as today) |

Rules the table keeps:

- **Mutually exclusive and exhaustive.** A table-driven test enumerates every
  combination of state × report × question × input-since × rollover and checks
  that exactly one row matches.
- **A person's input releases rows 2 and 3.** Typing into a `blocked` session
  is the person acting, so it moves on to the next matching row without waiting
  for the session to report again. A `ready` session a person types into is
  being reviewed, so it drops to row 5 or 6.
- **No free-text inference.** A summary that says "waiting for you" does not
  make a person stage. Only the fields do.

## 4. Where it shows

- **Home, first:** "Needs you", the sessions in rows 1–3 across every project,
  oldest first, each with its summary or question and one action (open the
  session, or answer the question inline when it has options). Empty takes no
  space. Its count is the length of that list, nothing else.
- **Sidebar:** the stage's shape and word beside the session (red line 4), in
  place of the state when the stage is 1–4.
- **Notifications** (browser, chat bridge): on *entering* rows 1–3, once per
  entry, with the summary or the question. Re-entering after a person's input
  notifies again. Nothing else notifies on report changes.
- **Members:** the owner's Members page shows each member's rows 1–3 count,
  read through the existing owner reads (stage M §2.4). It never shows content
  beyond what those reads return.

## 5. How a session reports

```sh
vibepanel me report ready --summary "PR #12 opened: retry on 429, tests added"
vibepanel me report blocked --summary "needs write access to the eval bucket"
vibepanel me ask "Run the full sweep (6 h) or the 2-seed check (40 min)?" --option sweep --option check
vibepanel me ask --clear
```

Through the existing session-token door (`/api/me`, red line 8's `me` routes),
so nothing new is reachable from outside a session. The panel does not tell an
agent to report. The instruction belongs in the project's agent rules (the
Harness rules, a skill), where the person keeps it, which matches the source
project's "behaviour a team describes in words is prompt text, not a setting".
A session that never reports stays in row 7, as every session is today.

## 6. Later, each with its own approval

- **Sources and a Policy.** A GitHub repository (issues and PR comments that
  address the agent) and the chat bridge as Sources. Their events become
  candidate tasks on a project's board under a written Policy: who may ask, in
  that Source's own identities. A new Source starts in **record-only** mode,
  where the board shows what would have been started and nothing starts. The
  gate is deterministic: allowed list and addressing. A model-run assessment
  is a later decision of its own.
- **Subscriptions.** A pull request a session opened feeds its review comments
  and CI results back into that session, pasted only at its input box (the R3
  machinery that already refuses to type into a dialog). A person's comment
  resumes an idle session; a bot's does not.
- **Mandate.** Work started from a Source records why it was allowed: the rule,
  the sender, the Policy version. A Policy change is delivered to running work
  as a note and never cancels it.

## 7. Tests that must exist before this merges

- The report enum mirrored in `wire.ts` (as `AllStates` is).
- `me report` and `me ask` refuse unknown values, missing summaries, oversized
  text and a fifth option.
- The stage table: exhaustive and exclusive (§3), and the release on input.
- Home's count equals its list's length.
- A notification fires once per entry into rows 1–3 and not on other changes.
- A summary containing "waiting for you" leaves the stage alone.
- A browser check: a question answered inline from Home reaches the session's
  input, and the row leaves "Needs you".

## 8. Decisions for the owner

1. The six report values in §2 and the seven rows in §3, as written or changed.
2. Where the report lives: **columns on `sessions` (migration 044)**, which
   survive a restart, and whose rollback is the binary plus the pre-deploy
   snapshot, or process memory only, which is lost on restart and needs no
   migration.
3. Notifications on entering rows 1–3: on by default, or off until switched on.
4. Order against S4 (splitting the vibepanel periphery): this first, or after.
