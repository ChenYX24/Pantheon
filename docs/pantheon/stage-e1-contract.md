# Pantheon stage E1 contract — execution service over file tasks

Status: frozen for tasks E1a (backend) and E1b (frontend), 2026-10-10. Builds on
stage A/A.2/B contracts. Purpose: Pantheon itself carries a task from "planned"
to "reviewed, merged and reported", so progress no longer depends on an outside
chat session staying open. One writer per project, every step leaves a file.

## 1. Switches

- Flag `--home-execute off|allow` (env `VIBEPANEL_HOME_EXECUTE`), default `off`.
  With `off` every route below still answers, but nothing starts and the UI says why.
- Runtime switch (DB setting `home.execute.enabled`, default false), only settable when
  the flag is `allow`: `GET/PUT /api/home/execution` `{enabled}`.
- Instance concurrency: `--home-max-runs` (default 2). One active run per project.

## 2. Project autonomy (file-backed, `pantheon.json` via the existing meta PATCH)

New keys: `autonomy: off|stage|full` (default `off`), `approvedStages: [string]`,
`autoMerge: bool` (default false), `maxAttempts` (1–3, default 2),
`attemptMinutes` (5–120, default 30), `verifyScope` (`auto` default; see §4).

A task is **eligible** when: execution is enabled; project autonomy is `stage` and the
task's `stage` is in `approvedStages`, or autonomy is `full`; task `status: planned`;
every `depends_on` task is `done`; the project checkout exists and is a Git repo; no
active run for the project; instance below `--home-max-runs`. The eligible task with
the highest priority (P0 > P1 > … > none), then oldest `updated`, is claimed.
`POST .../tasks/{taskId}/run` starts one task immediately regardless of autonomy (still
needs execution enabled, Git checkout, no active run, dependencies done → else 409 with reason).

Approving a stage, changing autonomy or editing a task never starts work by itself
beyond these rules; revoking a stage stops nothing that is already running.

## 3. Runs (database, rebuildable receipts in files)

Table `home_runs(id, project_id, task_id, attempt, state, harness, model, reviewer,
branch, worktree, session_id, base_commit, head_commit, started_at, finished_at,
summary, checks_json)` with a unique partial index on `project_id` where state in
(`running`,`reviewing`). States: `running → reviewing → accepted | rejected | blocked |
failed | stopped`, plus `merged` after a merge.

Claiming a task: set its file `status: in_progress`, `session: <session id>`; create
branch `pantheon/<task-id>` (suffix `-2`, `-3` if it exists) and worktree
`<data-dir>/home-runs/<project>/<run-id>` from the checkout's current `HEAD` (uncommitted
changes in the checkout are not carried; record that in the run summary as a warning).
Write `job.json` into `<data-dir>/home-runs/<project>/<run-id>.d/` and start the worker
as a tmux session in the project's panel project (created if missing), title
`任务 · <task title>`, so the user can watch it in the terminal view.

## 4. Worker (`vibepanel home-worker <job.json>`)

Reuse `parthenon.Worker`/`RunAgent` behaviour (primary with write access in the
worktree, failover to secondary within `maxAttempts`, independent read-only acceptance
by a *different* model) adapted to file tasks:

- Executor pair: task `primary`/`secondary` (`harness/model`); missing → project defaults
  `codex/<codex default>` primary, `claude/<claude default>` secondary (§B2 models).
- Prompt: task file (title + body), project ACTIVE_CONTEXT.md (≤16 KiB), the latest
  handoff of this task if any, allowed resources summary (§B4, no secrets), and the
  rules: work only in this worktree; commit nothing (the worker commits); no push; no
  deploy; stop and report if input or permission is needed.
- Verification commands: lines of the first fenced block under a heading
  `## 验收命令` or `## Verify` in the task body. Each runs in the worktree with a 10-minute
  timeout; with `verifyScope: auto` and systemd available, inside
  `systemd-run --user --scope -p MemoryMax=1200M -p CPUQuota=100% --nice=19`
  (same helper as the agent scope). No commands → acceptance relies on the reviewer
  only and the run can at best be `accepted` with a "no executable check" note.
- After the primary (or secondary) succeeds: `git add -A && git commit` in the
  worktree with message `<task-id>: <title>` and trailer
  `Co-Authored-By: <harness> <model> <noreply@anthropic.com|noreply@openai.com>`.
- Reviewer: the other harness, read-only, sees the diff (`git diff base..head`, ≤ 200 KiB)
  and check results; answers JSON `{"verdict":"accept|reject","reasons":"...","followups":["..."]}`.
- Writes `result.json` (state, harness/model used, reviewer, head commit, checks with
  exit codes and last 2 KiB of output each, summary) and `progress.json` while running.
- The worker never touches the task file; the server applies results (§5).

## 5. Reconciliation (server ticker, every 5 s, also on startup)

For each active run: read `progress.json`/`result.json`; if the tmux session is gone
for >30 s without a result → `failed` ("worker vanished"). On a result:

1. Append `agent-docs/tasks/<task>/handoff-NNN.md` (next number) with: run id, attempt,
   executor and reviewer, branch, base→head commit, files changed (`git diff --stat`),
   checks with pass/fail, reviewer reasons and follow-ups, warnings, and **Next step**.
2. Update the task file: `accepted` → `status: awaiting_review` (or `done` after an
   auto-merge, §6); `rejected`/`blocked`/`failed` → `status: blocked`,
   `blocked_reason: <one line>`; `stopped` → `status: planned`.
3. Write a report `agent-docs/reports/<YYYY-MM-DD-HH-MM>-run-<task>.md` (`kind: report`,
   `needs_user: true` unless auto-merged and accepted) with a 1–2 sentence summary,
   so the existing to-do list and Feishu notifier pick it up.
4. When every task of a stage is `done`, write one stage summary report
   (`kind: report`, title `阶段 <stage> 完成`), once.

Follow-ups from the reviewer are **not** turned into tasks automatically; they appear in
the handoff and as a `create_task` suggestion the project manager can offer.

## 6. Merge

`POST /api/home/projects/{id}/runs/{runId}/merge`: only for `accepted` runs. In the
checkout: refuse (409) if it has uncommitted changes or is not on a branch; else
`git merge --no-ff pantheon/<task>` with message `merge: <task-id> <title>` and the run's
trailer. Conflicts → `git merge --abort`, run stays `accepted`, task `blocked` with
"merge conflict, replan", 409. Success → run `merged`, task `done`, worktree removed,
branch kept. With `autoMerge: true` the server performs this right after acceptance.
Never pushes.

## 7. Other routes (add to the development allow-list with exact methods)

- `GET /api/home/execution` → `{flag, enabled, maxRuns, active:[Run]}`; `PUT` `{enabled}`.
- `GET /api/home/projects/{id}/runs` → last 50 runs (`Run` = table columns in camelCase + `checks`).
- `GET /api/home/projects/{id}/runs/{runId}` → run + `log` (last 16 KiB of the worker's tmux pane via the existing capture helper) + `handoff` file name.
- `POST .../tasks/{taskId}/run`, `POST .../runs/{runId}/stop` (writes a `stop` file; the
  worker stops the agent within 10 s; run `stopped`), `POST .../runs/{runId}/merge`.
- `/api/home` project objects gain `activeRun: {id, taskId, state, startedAt}|null`.

## 8. Frontend

- Project page: new right-pane tab **执行** (and bottom tab on phone): execution status
  banner (flag off / switched off / on, with the switch when allowed), autonomy segmented
  control 关闭 / 按阶段 / 全自动 (ConfirmDialog for 全自动), per-stage approve/revoke chips
  for stages present in tasks, autoMerge toggle, attempts/minutes inputs; active run card
  (task, executor → reviewer, elapsed, live log tail polled every 3 s, 打开终端, 停止);
  run history table (state chip, task, models, duration, commit, 合并 for accepted, link to
  handoff in the task view).
- Tasks table/rows: "立即执行" action for `planned` tasks (disabled with tooltip reason).
- Home cards: a running indicator with task id when `activeRun` is set.
- Home header: execution switch status dot.
- Same capabilities on phone; no horizontal page scroll at 360 px; `home.exec.*` i18n.

## Tests

Backend: eligibility rules (autonomy, approved stages, deps, priority order, one per
project, instance cap, flag/switch); claim writes task file and creates branch/worktree in
a temp git repo; worker with fake `claude`/`codex` executables: primary success + commit
+ verify pass + reviewer accept; primary fail → secondary; reviewer reject; verify fail;
stop file; result reconciliation writes handoff/report/task status exactly as §5; stage
summary once; merge success, dirty checkout 409, conflict abort; vanished worker; scope
argv for verify commands; allow-list; API doc coverage.
Frontend: vitest for helpers (eligibility explanation text, state chips, run durations,
autonomy form state).
