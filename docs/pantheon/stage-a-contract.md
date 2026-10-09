# Pantheon Stage A contract — report home, to-do, PM chat, Feishu one-way

Status: frozen for implementation tasks A2 (backend) and A3 (frontend), 2026-10-09.
Decision record: Harness `projects/pantheon/agent-docs/adr/Parthenon状态权威与双视图_2026-10-09-16-36.md`.

## Principles

- **Files are the authority.** Projects, goals, tasks and reports are read from the
  cyx registry and the Harness project folders. The database only holds runtime
  data that may be lost: PM chat messages and notification deliveries. Deleting the
  database must yield the same `/api/home` projects, tasks and to-dos.
- **Read-mostly.** Nothing in Stage A runs an agent with write access or enables
  the workflow execution service. The only writes are: task files created or
  re-statused explicitly by the user, manual sessions created explicitly by the user,
  PM chat messages and notification delivery rows.
- Desktop and phone have the same capabilities. The phone layout is not an inbox.

## 1. Sources (read-only)

`--cyx-home` (default `~/.cyx`). Read `<cyx-home>/local.json`:

```json
{"version":1,"projects_root":"/home/cyx/projects","paths":{"<id>":"/abs/checkout", "cyx-agent-harness":"/abs/harness"}}
```

Harness root = `paths["cyx-agent-harness"]`. If the file or that key is missing,
`/api/home` returns `{"available":false,"reason":"..."}` with HTTP 200.

For every directory `<harness>/projects/<id>/`:

| File | Use |
|---|---|
| `project.json` | `id, aliases[], portfolio, category, status, state_mode, sync, repo?, parent?, merged_into?` |
| `ACTIVE_CONTEXT.md` | goal, active docs, last verified commit (see §2) |
| `agent-docs/tasks/<task-id>/task.md` | tasks (see §3) |
| `agent-docs/reports/*.md` | reports and questions to the user (see §4) |

Rules: id must match `^[a-z0-9][a-z0-9._-]{0,63}$`; skip anything else. Read each
file with a 256 KiB cap; at most 500 tasks and the newest 50 reports per project.
Never follow a symlink that resolves outside the Harness root. Parse errors never
fail the request: they become entries in `warnings`. Checkout path = `paths[<id>]`
(may be absent → `path: ""`, `pathExists: false`).

Default listing excludes projects whose status is `archived` or `merged`
(`?all=1` includes them).

Cache: in memory, keyed by file path + mtime + size; a full rebuild is cheap and is
what happens after restart.

## 2. ACTIVE_CONTEXT.md parsing

Top-level bullets of the form `- **<Key>**：<value>` or `- **<Key>**: <value>`
(full-width or ASCII colon). Key matching is case-insensitive:

| Field | Keys |
|---|---|
| `goal` | `Goal`, `目标` |
| `activeDocs` | `Active plan`, `活动文档` — extract markdown links `[text](href)` as `{title, href}` |
| `lastVerified` | `Last verified commit`, `已验证基线`, `最后验证` |
| `blockers` | `Blockers`, `阻塞` — free text, becomes a project-level blocker |

Values are plain text with markdown links reduced to their text, trimmed to 600
characters. Missing keys → empty string / empty list.

## 3. Task file format

`agent-docs/tasks/<task-id>/task.md`, task-id matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
and equal to the frontmatter `id`.

```markdown
---
id: A2
title: Home index and API
status: in_progress
stage: A
primary: codex/gpt-6-astra
secondary: claude/claude-opus-5-5
depends_on: [A1]
session: vp_1234abcd
blocked_reason:
session_status: ok
updated: 2026-10-09T18:00:00+08:00
---
Free markdown: acceptance, notes. Handoffs live beside it as handoff-NNN.md.
```

Frontmatter: lines `key: value` between the first two `---` lines; list values
`[a, b]`; empty value = empty. Unknown keys are preserved on rewrite.

- `status` ∈ `planned, in_progress, awaiting_review, awaiting_approval, blocked, done, cancelled`;
  anything else → `warnings`, treated as `planned`.
- `session_status` ∈ `ok, rollover_due` (default `ok`).
- `primary` / `secondary` are `<harness>/<model>`.
- `rev` (returned by the API) = first 16 hex of SHA-256 of the file bytes.

Handoff count = number of `handoff-*.md` files beside `task.md`.

## 4. Report file format

`agent-docs/reports/<name>.md`:

```markdown
---
title: Stage A backend ready for review
at: 2026-10-09T19:30:00+08:00
kind: report        # report | question
needs_user: false
task: A2
summary: One or two sentences shown on the card.
---
Body markdown.
```

Order by `at` (fallback: file mtime). Latest report = newest `kind: report` or `question`.

## 5. To-do derivation

| kind | When | Link |
|---|---|---|
| `awaiting_review` | task status `awaiting_review` | project + task |
| `awaiting_approval` | task status `awaiting_approval` | project + task |
| `blocked` | task status `blocked` (detail = `blocked_reason`), or ACTIVE_CONTEXT blockers | project (+ task) |
| `question` | report with `needs_user: true` | project + report |
| `session_waiting` | live panel session in state `waiting` whose project path equals the cyx checkout path | session |
| `session_rollover` | task `session_status: rollover_due` | project + task (+ session) |

To-do id = first 16 hex of SHA-256 of `kind|projectId|taskId-or-reportFile-or-sessionId|rev-or-stateChangedAt`,
so it is stable while nothing changes and new when something does.
Sort: `question, awaiting_approval, blocked, awaiting_review, session_waiting, session_rollover`, then newest first.

Sessions: the panel's live sessions are matched to a cyx project when the panel
project's `path` equals the cyx checkout path after `filepath.Clean` and symlink
evaluation. This is the only runtime data in the home view.

## 6. HTTP API (all require the normal authenticated session; add to the development allow-list)

### `GET /api/home[?all=1]`

```jsonc
{
  "available": true,
  "generatedAt": "RFC3339",
  "projects": [{
    "id": "pantheon", "aliases": ["parthenon"], "portfolio": "agent-platform",
    "category": "product", "status": "active",
    "path": "/home/cyx/projects/Pantheon/dev", "pathExists": true,
    "panelProjectId": "p_..." /* or null */,
    "goal": "...", "activeDocs": [{"title":"...","href":"agent-docs/plan/..."}],
    "lastVerified": "...", "blockers": ["..."],
    "taskCounts": {"planned":0,"in_progress":0,"awaiting_review":0,"awaiting_approval":0,"blocked":0,"done":0,"cancelled":0,"total":0},
    "stages": [{"name":"A","done":1,"total":6}],
    "latestReport": {"file":"x.md","title":"...","summary":"...","at":"...","kind":"report","needsUser":false} /* or null */,
    "sessions": [{"id":"...","name":"...","state":"working|waiting|done","agent":"claude","stateChangedAt":"..."}],
    "usage": {"known": false},
    "updatedAt": "newest mtime among the project's files"
  }],
  "todos": [{"id":"...","kind":"awaiting_review","projectId":"pantheon","title":"...","detail":"...","at":"...",
             "link":{"projectId":"pantheon","taskId":"A2","reportFile":"","sessionId":""}}],
  "warnings": [{"projectId":"pantheon","file":"agent-docs/tasks/X/task.md","message":"..."}]
}
```

Project order: projects with to-dos first, then by `updatedAt` desc.

### `GET /api/home/projects/{id}`

`{ "project": <same object>, "tasks": [Task], "reports": [Report], "todos": [...] }`

`Task = {id,title,status,stage,primary,secondary,dependsOn[],session,blockedReason,sessionStatus,updated,handoffs,body,rev,file}`
`Report = {file,title,at,kind,needsUser,task,summary,body}` (body capped at 16 KiB).

### `POST /api/home/projects/{id}/tasks`

Body `{title, stage?, status? (default planned), primary?, secondary?, dependsOn?, body?, id?}`.
Id defaults to `T-YYYYMMDD-HHMMSS` (local time). Creates the directory and writes
`task.md` atomically (temp file + rename, mode 0644). 409 if it exists. Returns `Task`.

### `PATCH /api/home/projects/{id}/tasks/{taskId}`

Body `{rev, status?, blockedReason?, sessionStatus?, session?}`. 409 `{error:"stale", rev}`
when `rev` mismatches. Rewrites only those frontmatter keys plus `updated`, keeping
everything else byte-identical. Returns `Task`.

### `POST /api/home/projects/{id}/sessions`

Body `{profileId?: string, name?: string}`. Finds the panel project whose path equals
the cyx checkout path, creating it if missing (same validation as `POST /api/projects`),
then creates a session through the same code path as the normal create-session
endpoint (launch profile or plain shell). Allowed only where manual session creation
is allowed (`DevelopmentTerminal` in development). Returns `{sessionId, panelProjectId}`.

### `GET /api/home/projects/{id}/discussion` / `POST` same path

GET → `{messages:[{id,role:"user|assistant",text,at,executor?,suggestions?,suggestedModel?}]}` (last 100).

POST body `{message, executor:{harness:"claude|codex", model}}`. Runs the existing
read-only `parthenon.RunAgent` in the cyx checkout path (or the Harness project
folder if the checkout is missing), 3-minute timeout, no write access. Prompt
includes the ACTIVE_CONTEXT, task summaries, latest 5 reports and the last 12
messages. The model must answer JSON:

```json
{"reply":"...",
 "suggestions":[{"type":"create_task","task":{"title":"...","stage":"A","primary":"codex/gpt-6-astra","secondary":"claude/claude-opus-5-5","body":"..."}},
                {"type":"set_status","taskId":"A2","status":"awaiting_review"},
                {"type":"create_session","name":"..."}],
 "suggestedModel":{"harness":"claude","model":"claude-opus-5-5","reason":"..."}}
```

Suggestions are **never applied automatically**; the UI applies one only when the
user clicks it, through the endpoints above. Invalid JSON → reply is the raw text,
no suggestions. Messages persist in a new table `home_messages(id, project_id, role,
text, executor_json, payload_json, created_at)`; losing it loses only chat history.

The executor list comes from the existing `GET /api/workflow/executors` (or the
same function).

### `GET /api/home/notifications`

`{mode:"off|dry_run|send", items:[{todoId, projectId, channel, status:"dry_run|sent|failed|pending", text, attempts, createdAt, sentAt}]}` newest 100.

## 7. Feishu one-way notifications

Config `--home-notify off|dry_run|send` (default `dry_run` when `--development`, else `off`)
and `--home-public-url` (default empty → links are relative paths).

A ticker (every 60 s, first run 10 s after start) computes `/api/home` to-dos. For
each to-do id not yet in `home_deliveries` it inserts one row per recipient
(`UNIQUE(todo_id, channel, peer)`, `ON CONFLICT DO NOTHING`). Recipients are the
existing workflow notification recipients for the Feishu channel. With no recipient,
a single `dry_run` row with `peer=""` is recorded.

- `dry_run`: render and store the text, status `dry_run`, never call an adapter.
- `send`: send through the existing chat bridge adapter as plain text (no buttons,
  no inbound handling), up to 3 attempts with 60 s × attempt backoff, 24 h expiry.

Text: `[Pantheon] <project id> · <kind label> · <title>\n<detail>\n<link>` where link is
`<public-url><base-path>/home?project=<id>&task=<taskId>` or `/?session=<sessionId>`.

On first start with an empty `home_deliveries` table, the current to-dos are
recorded as `status:"baseline"` without sending, so a wiped database does not
re-send everything.

## 8. Frontend

- Route `/home` under the base path (`HOME_PATH`), new `{kind:'home'}` in `routes.ts`
  and a branch in `main.tsx`. Link to it from the panel sidebar and the project
  workspace header. Query `?project=<id>&task=<id>` opens that project.
- `HomePage.tsx`: header (title, refresh, last generated time, link to panel), to-do
  list, project cards grid. Wide (≥ 768 px): to-do as a right column. Narrow: to-do
  as a collapsible section above the cards; everything else identical.
- Project card: id + aliases, status, goal (3 lines), stage progress bars, task
  counts, latest report (title, summary, relative time), blockers, live session
  dots (`StateDot`), `usage` shown as "unknown" when `known:false`.
- Project view (full-width page on narrow, wide side sheet on desktop) with tabs:
  **对话/Chat** (messages, executor picker from executors list, suggested-model chip
  with "use this model", suggestion buttons that call the APIs), **任务/Tasks**
  (grouped by stage, status select → PATCH with rev, "new task" form),
  **汇报/Reports**, **会话/Sessions** (list with dots, "open in terminal" → `/?session=`,
  "new session" → POST sessions with launch-profile picker from existing profiles API).
- Polling: `/api/home` every 10 s while visible; project detail every 10 s while open.
- Use existing tokens (`--vp-*`, `bg-surface`, `vp-control`), lucide icons, `t()` with
  `home.*` keys in both zh and en, `ConfirmDialog` for status changes to `done`/`cancelled`.
- No horizontal scroll at 360 px width.

## 9. Tests required

Backend: parser tests (frontmatter, ACTIVE_CONTEXT variants, bad files → warnings,
symlink escape), to-do derivation and stable ids, `/api/home` with a temp Harness and
temp `local.json`, rebuild after reopening a fresh database gives identical projects
and to-dos, task create/patch incl. 409 and byte preservation, notification dedup,
baseline, dry_run never calls an adapter. Frontend: vitest for pure helpers
(to-do sorting/labels, stage progress, relative time, link building).
