# Pantheon stage A.2 contract — chat, multi-dimensional board, replies, Feishu send

Status: frozen for tasks A7 (backend) and A8 (frontend), 2026-10-09. Extends
`stage-a-contract.md`; everything there still holds unless changed here.

User feedback driving this round (A6 review):
1. Questions in reports cannot be answered in place.
2. The model cannot be chosen (Claude model field is empty, so Send is disabled);
   the chat should feel like ChatGPT: multi-turn, bubbles, composer at the bottom.
3. Feishu may actually send.
4. Board management should feel like Feishu Bitable (多维表格): many single/multi-
   select fields (status, priority, tags…), filters, grouping, inline editing, and
   the same changes possible by talking to the project manager.
5. Page structure and navigation need work.

Root causes found on the live dev instance:
- `Executors()` leaves the Claude model empty when `~/.claude/settings.json` has no
  `model` (it has none here).
- The dev backend unit has `MemoryMax=256M`; `claude`/`codex` CLIs are children of
  the backend, so a real run (≈300 MB) is OOM-killed. Production has no such cap,
  but agent runs must not compete with terminal sessions either.
- No Feishu channel or peer is configured in either instance.

## B1. Agent runs in their own scope

New config `--agent-scope` (env `VIBEPANEL_AGENT_SCOPE`): `auto` (default) | `off`.
With `auto`, when `systemd-run` exists and `XDG_RUNTIME_DIR` (or `/run/user/<uid>`)
has a `bus`, `RunAgent` executes

`systemd-run --user --scope --quiet --collect -p MemoryMax=1200M -p CPUQuota=100% --nice=10 -- <harness> <args…>`

with `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` set for that child. Fallback:
direct exec (today's behaviour). Stdin/stdout/timeout handling unchanged. Unit test
covers the argv construction (no real systemd needed).

## B2. Models

`GET /api/home/models` →
```json
{"harnesses":[
 {"harness":"claude","installed":true,"default":"claude-opus-5-5","source":"built-in default",
  "models":["claude-opus-5-5","claude-sonnet-5-5","claude-haiku-4-5-20251001"]},
 {"harness":"codex","installed":true,"default":"gpt-6-astra","source":"Codex config",
  "models":["gpt-6-astra","gpt-6.1-sol"]}]}
```
Default = configured model if any, else the first built-in. `models` = configured
model first, then built-ins, then any keys of `[tui.model_availability_nux]` in
`~/.codex/config.toml`, de-duplicated. Free-text models remain accepted by the
discussion API. Keep `/api/workflow/executors` unchanged.

## B3. Threads and asynchronous replies

`home_messages` gains `thread_id TEXT NOT NULL DEFAULT 'main'`, `status TEXT NOT NULL
DEFAULT 'done'` (`pending|done|failed`), `error TEXT`. New table
`home_threads(id, project_id, title, created_at, updated_at)`; the implicit thread
`main` exists for every project.

- `GET /api/home/projects/{id}/threads` → `{threads:[{id,title,updatedAt,messageCount}]}` newest first, `main` always present.
- `POST /api/home/projects/{id}/threads` body `{title?}` → thread (title default "新对话 HH:MM").
- `PATCH /api/home/projects/{id}/threads/{threadId}` `{title}`; `DELETE` (not `main`) deletes thread + messages.
- `GET /api/home/projects/{id}/discussion?thread=<id>` → messages of that thread (last 200) with `status`/`error`.
- `POST /api/home/projects/{id}/discussion` body `{message, executor, thread?}` → **202** `{user:Message, assistant:Message(status:"pending")}` immediately. A goroutine runs the agent (3-minute timeout, read-only) and updates the assistant row to `done` or `failed` with `error`. At most one pending run per project (409 otherwise). Pending rows older than 10 minutes at startup become `failed` ("interrupted by restart").
- `POST /api/home/projects/{id}/discussion/{messageId}/retry` re-runs a failed assistant turn in place.
- The first user message of a thread whose title is still default renames it to the first 30 characters.

Prompt context (so the manager can actually answer "what is the state of the
project"): full ACTIVE_CONTEXT.md (≤16 KiB), MEMORY.md (≤8 KiB), all tasks as a
compact table (id, title, status, priority, tags, stage, owner, primary/secondary,
updated), the 5 newest reports (title, kind, needsUser, summary, any replies), field
definitions, `git -C <checkout> log --oneline -8` and `git status --short | head -40`
when the checkout exists, the last 16 messages of the thread. Instruct the model to
answer in the user's language, to answer status questions directly from this
context, and to output the JSON object of §6 of stage-a-contract, extended with the
suggestion types below. Accept the JSON in a fenced block or bare; otherwise the
whole text is the reply.

New suggestion types (applied only on click, via the APIs below):
`{"type":"set_fields","taskId":"A2","fields":{"priority":"P1","tags":["前端"],"owner":"codex","due":"2026-10-12","status":"in_progress"}}`,
`{"type":"set_project","fields":{"labels":["产品"],"priority":"P0","owner":"cyx","phase":"开发"}}`,
`{"type":"reply_report","file":"x.md","text":"..."}`.

## B4. Fields (Bitable-style), all file-backed

Field definitions: `<harness>/pantheon/fields.json` (global, optional). Missing file =
defaults below. `rev` = SHA-256 prefix like tasks.
```json
{"task":{
  "status":{"options":[{"value":"planned","label":"待规划","color":"gray"},{"value":"in_progress","label":"进行中","color":"blue"},{"value":"awaiting_review","label":"待评审","color":"purple"},{"value":"awaiting_approval","label":"待批准","color":"orange"},{"value":"blocked","label":"阻塞","color":"red"},{"value":"done","label":"已完成","color":"green"},{"value":"cancelled","label":"已取消","color":"gray"}]},
  "priority":{"options":[{"value":"P0","color":"red"},{"value":"P1","color":"orange"},{"value":"P2","color":"blue"},{"value":"P3","color":"gray"}]},
  "tags":{"options":[{"value":"前端","color":"blue"},{"value":"后端","color":"purple"},{"value":"设计","color":"pink"},{"value":"研究","color":"teal"},{"value":"运维","color":"orange"}]}},
 "project":{
  "labels":{"options":[{"value":"产品","color":"blue"},{"value":"研究","color":"teal"},{"value":"基础设施","color":"orange"}]},
  "priority":{"options":[{"value":"P0","color":"red"},{"value":"P1","color":"orange"},{"value":"P2","color":"blue"},{"value":"P3","color":"gray"}]},
  "phase":{"options":[{"value":"规划","color":"gray"},{"value":"开发","color":"blue"},{"value":"验证","color":"purple"},{"value":"维护","color":"green"}]}}}
```
Colors ∈ `gray,blue,green,orange,red,purple,pink,teal,yellow`. Status values are fixed
(labels/colors editable). Values not in the option list are kept and shown gray.

- `GET /api/home/fields` → `{fields, rev}`; `PUT /api/home/fields` `{rev, fields}` → atomic write; 409 on stale rev; validates shape.

Task frontmatter gains `priority`, `tags: [..]`, `owner`, `due` (YYYY-MM-DD). Task
JSON gains the same keys (`tags` array, empty string when unset).
`PATCH .../tasks/{taskId}` additionally accepts `title, stage, priority, tags, owner,
due, primary, secondary, dependsOn`; same rev/409 and byte-preservation rules.

Project metadata: `<harness>/projects/<id>/pantheon.json` (optional)
`{"labels":[],"priority":"","owner":"","phase":"","pinned":false}`. Project JSON gains
`meta` with these keys and `metaRev`. `PATCH /api/home/projects/{id}/meta`
`{rev, labels?, priority?, owner?, phase?, pinned?}` → atomic write (creates the file
with rev ""), 409 on stale. Pinned projects sort first in `/api/home`.

`GET /api/home/tasks[?all=1]` → `{tasks:[Task & {projectId}], fields}` across all listed
projects (≤ 2000 rows), for the table view.

## B5. Replying to reports

`POST /api/home/projects/{id}/reports/{file}/reply` `{text, rev?}`. Appends to the
report file

```
\n\n## 回复 · <RFC3339 local>\n\n<text>\n
```
and sets frontmatter `needs_user: false` (byte-preserving otherwise; atomic). Report
JSON gains `rev` and `replies:[{at,text}]` parsed from those sections. The reply is
also stored as a user message in thread `main` prefixed `回复汇报《title》：` so the
manager sees it. 409 when `rev` is given and stale. Its to-do disappears because
`needs_user` is false.

## B6. Feishu sending via group bot webhook

Notification settings live in the DB (credentials are not project state), secrets
encrypted with the existing `internal/secret` box used for chat channels.

- `GET /api/home/notify-settings` → `{mode, flagMode, webhookConfigured, signed, publicUrl}` (never the URL or secret).
- `PUT /api/home/notify-settings` `{mode?, webhookUrl?, secret?, publicUrl?}`. `mode` may be set to `send` only if the
  `--home-notify` flag is not `off`. `webhookUrl` must be `https://open.feishu.cn/open-apis/bot/v2/hook/...` or
  `https://open.larksuite.com/open-apis/bot/v2/hook/...`; empty string clears it. Runtime mode/publicUrl override the flags.
- `POST /api/home/notify-settings/test` sends "[Pantheon] 测试通知" through the webhook now; returns `{ok, error?}`.
- The notifier treats a configured webhook as one recipient (`channel:"feishu_webhook", peer:"webhook"`) in addition to
  paired Feishu peers. Body: `{"msg_type":"text","content":{"text":...}}`; when a secret is set add `timestamp` (unix
  seconds) and `sign` = base64(HMAC-SHA256(key = "<timestamp>\n<secret>", message = empty)). Response `code != 0` is a failure.
- Baseline and dedup rules unchanged; switching to `send` never sends rows that were already `baseline`/`dry_run`.

## B7. Allow-list

All new routes are added to `homePlanningRoute` with exact methods. Notify-settings
PUT/test are allowed in development as well (they only touch home notification
state).

## F. Frontend structure

Routes (all base-path aware; `routes.ts` + tests):
- `/home` — overview with a view switcher persisted in the URL `?view=cards|table|todo` (default `cards`).
- `/home/p/<projectId>` — full project page (replaces the side sheet). Query `tab=chat|tasks|reports|sessions|info`,
  `thread=<id>`, `task=<id>`, `report=<file>`. Old `/home?project=<id>&…` links redirect client-side to the new form.
  Back button returns to `/home` keeping the previous view/filter query.

Home overview:
- Header: brand, view switcher (卡片 / 表格 / 待办), search box (filters projects/tasks by text), notification bell
  (opens the notification settings dialog), refresh, language, theme, panel link.
- **Cards**: as now, plus project labels/priority/phase chips, pin toggle; a card click opens the project page.
- **Table** (多维表格): toggle "任务 | 项目".
  - Task table columns: 项目, 标题, 状态, 优先级, 标签, 阶段, 负责人, 主执行, 截止, 更新. Status/priority are colored
    single-select chips, tags are multi-select chips. Clicking a cell opens an inline editor (popover with option list
    and search, or text/date input); saving PATCHes with `rev`; 409 shows a conflict toast and reloads the row.
  - Toolbar: filter (project, status multi, priority multi, tags multi, owner), group by (none/项目/状态/优先级/阶段/标签),
    sort (更新/优先级/截止/标题), "新任务" (choose project), "字段设置" (edit options: add/rename/recolor/remove; PUT fields).
    Filter/group/sort are kept in the URL query.
  - Project table columns: 项目, 目标, 标签, 优先级, 阶段, 负责人, 任务数, 待办数, 更新; inline editing via meta PATCH.
  - Grouped rows show a group header with count. Sticky header; horizontal scroll inside the table container only.
  - Narrow (<768px): the same data as a card list (one card per row) with field chips tappable to edit; filter/group
    in a bottom sheet. No page-level horizontal scroll at 360px.
- **Todo**: the to-do list full width, grouped by kind, each item links to the right place (question → report reply box).

Project page:
- Wide: two panes. Left (≈60%) chat. Right (≈40%) tabs 任务 / 汇报 / 会话 / 信息 (info = goal, active docs, last
  verified, labels/priority/phase editable, blockers). Thread list as a collapsible column/menu at the chat's left
  ("新对话", rename, delete).
- Narrow: single pane with a bottom tab bar 对话 / 任务 / 汇报 / 会话 / 信息; thread list behind a menu button.
- Tasks tab reuses the table component filtered to the project (card list on narrow).

Chat (ChatGPT-like):
- Scrollable message list with user bubbles right, assistant left (markdown), sticky composer at the bottom: autosizing
  textarea, Enter sends, Shift+Enter newline, IME-safe (`isComposing`), send button, model picker (dropdown grouped by
  harness from `/api/home/models`, default preselected, plus "custom model…" entry) remembered per project in
  localStorage (try/catch).
- After sending: user bubble appears at once; an assistant bubble shows "思考中… <elapsed>s" and polls the thread every
  2 s until `done`/`failed`; failed shows the error and a Retry button. Composer disabled only while that project has a
  pending run. Auto-scroll to bottom unless the user scrolled up ("回到底部" button).
- Suggestions render as action chips under the reply (创建任务 / 设置字段 / 回复汇报 / 新建会话 / 更新项目); applying one
  calls the API and marks it applied. Suggested model renders as a chip "改用 <model>" that switches the picker.
- Empty thread shows 3 starter prompts: "现在项目进展如何？", "下一步应该做什么？", "有哪些阻塞需要我处理？".
- Small line under the composer: "项目经理只读仓库；改动通过你确认的建议执行".

Reports tab: each report card; questions (`needsUser`) show a reply textarea + 回复 button; existing replies render
below the body. A to-do of kind `question` links to `/home/p/<id>?tab=reports&report=<file>` and focuses the box.

Notification settings dialog: mode segmented control (关闭 / 仅记录 / 发送; 发送 disabled with a hint when the flag
forbids it), webhook URL + 签名密钥 inputs (password type; shows "已配置" when configured; empty keeps the old value,
explicit "清除" clears), public URL, 发送测试 button with result, recent deliveries list (status chips).

General: existing tokens/`vp-control`/`vp-segmented`/`vp-tab`, lucide icons, `t()` keys under `home.*` in zh and en,
`ConfirmDialog` for destructive actions (delete thread, remove option, status → done/cancelled), `safeText` on all
file-sourced text, chrome-vocabulary rules respected. Remove the old `HomeProjectView` side sheet once replaced.

## Tests

Backend: agent-scope argv; models list composition; thread CRUD; async discussion (fake runner: pending → done,
failure → failed + retry, one-pending-per-project 409, restart marks stale pending as failed); prompt includes
ACTIVE_CONTEXT, tasks table and git lines (temp git repo); fields GET/PUT/409/validation and defaults; task PATCH of
new fields with byte preservation; project meta PATCH create/409; `/api/home/tasks`; report reply append +
needs_user false + to-do disappears + mirrored chat message; notify settings (URL validation, secrets never returned,
mode guard by flag); webhook signing exact value for a fixed timestamp/secret; webhook send via `httptest` server;
`TestTheAPIDocCoversEveryRoute` stays green (document every route in docs/api.md under "Pantheon home").

Frontend: vitest for pure helpers (filtering, grouping, sorting, URL query ↔ view state, option color mapping, route
parsing incl. legacy redirect, chat polling state machine, model picker defaults). `web/scripts/home-check.mjs` will be
extended by the Conductor during integration.
