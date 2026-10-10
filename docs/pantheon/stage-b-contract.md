# Pantheon stage B contract — resource manager v1

Status: frozen for tasks B1 (backend) and B2 (frontend), 2026-10-10. Builds on
`stage-a-contract.md` and `stage-a2-contract.md`.

Goal (user): one place for API keys/providers, servers (with live status, including
GPUs and API reachability) and other resources (datasets, accounts, services), each
with usage instructions, so the user never retypes them and every project can use
them. The GPU scheduling board (`~/projects/atombit-gpu-board`) stays a separate
product; Pantheon only reads its snapshot. Free capacity is never an authorization.

## Principles

- **Metadata and usage docs are files** in the Harness; **secret values live only in
  the panel database**, sealed with the existing `internal/secret` box. No API ever
  returns a secret value, not even a prefix or suffix.
- Checks that reach the network (provider, HTTP, SSH) run **only on explicit user
  action**, never on a timer, and never write anywhere remote.
- Every secret read for use (session injection, check) leaves a receipt row.

## 1. Resource files

`<harness>/pantheon/resources/<id>.md`, id `^[a-z0-9][a-z0-9._-]{0,63}$` equal to
frontmatter `id`. Same frontmatter syntax, rev and byte-preserving rewrite rules as task
files (stage A §3).

```markdown
---
id: openai-main
kind: api              # api | server | dataset | account | service | other
title: OpenAI 主账号
provider: openai       # api: anthropic | openai | openai-compatible | feishu | other
base_url: https://api.openai.com/v1
env: [OPENAI_API_KEY]  # variables this resource provides; secrets are stored under these names
ssh_alias:             # server: an alias from ~/.ssh/config
gpu_board_id:          # server: node id in the GPU board snapshot (defaults to ssh_alias)
url:                   # dataset/service/account: a non-secret location
projects: ["*"]        # "*" or project ids allowed to use it
tags: [模型]
check: provider        # none | provider | http | ssh
updated: 2026-10-10T10:00:00+08:00
---
## 用途
...
## 使用方法
...
## 限制
...
```

The body is the usage documentation shown in the UI and given to agents. Unknown keys
are preserved.

## 2. Secrets (database)

Table `resource_secrets(resource_id, name, value_enc BLOB, updated_at, PRIMARY KEY(resource_id,name))`,
sealed with context `"resource:" + id + ":" + name`. Names match `^[A-Z_][A-Z0-9_]{0,63}$`;
values ≤ 8 KiB. Table `resource_uses(id, resource_id, purpose, project_id, session_id, at)`
(purpose ∈ `session`, `check`). Table `resource_checks(resource_id, at, ok, summary, detail_json)`
keeps the latest 20 per resource.

Deleting a resource file through the API also deletes its secrets and checks.
A secret whose resource file disappeared is shown as "orphaned" in `GET /api/home/resources`
(`orphans: [{resourceId, names}]`) and can be deleted.

## 3. HTTP API (authenticated; add each to `homePlanningRoute` with exact methods)

- `GET /api/home/resources` →
  `{resources:[Resource], orphans:[...], warnings:[...]}`;
  `Resource = {id, kind, title, provider, baseUrl, env[], sshAlias, gpuBoardId, url, projects[], tags[], check, updated, body, rev, file,
  secrets:[{name, configured, updatedAt}], lastCheck:{at, ok, summary}|null, server: ServerStatus|null}`.
  `secrets` lists every `env` name (configured or not) plus any stored extra names.
- `GET /api/home/resources/{id}` → same object plus `checks` (latest 20) and `uses` (latest 50).
- `POST /api/home/resources` `{id?, kind, title, ...fields, body?}` → 201 Resource; id defaults to a slug of the title; 409 if exists.
- `PATCH /api/home/resources/{id}` `{rev, ...any frontmatter field, body?}` → Resource; 409 stale.
- `DELETE /api/home/resources/{id}?rev=<rev>` → 204; removes file, secrets, checks.
- `PUT /api/home/resources/{id}/secrets/{name}` `{value}` → `{name, configured:true, updatedAt}`; empty value → 400.
- `DELETE /api/home/resources/{id}/secrets/{name}` → 204.
- `POST /api/home/resources/{id}/check` → runs the configured check now (≤ 20 s), stores and returns `{at, ok, summary, detail}`:
  - `provider` anthropic: `GET {base_url or https://api.anthropic.com}/v1/models` with `x-api-key`
    (`ANTHROPIC_API_KEY`) or `Authorization: Bearer` (`ANTHROPIC_AUTH_TOKEN`), `anthropic-version: 2023-06-01`;
    openai / openai-compatible: `GET {base_url}/models` with `Authorization: Bearer <first env secret>`.
    `ok` = HTTP 200; `detail = {status, models: first 50 ids, modelCount}`. Balance is reported as `"unknown"`
    unless a provider exposes it (none in v1). Errors never include the key or full response body (first 200 chars, with the key redacted).
  - `http`: `GET url` (no secrets), `ok` = 2xx/3xx, `detail = {status, ms}`.
  - `ssh`: `ssh -o BatchMode=yes -o ConnectTimeout=8 -o ConnectionAttempts=1 <alias> true`,
    `ok` = exit 0, `detail = {exitCode, ms, stderr: first 200 chars}`. Alias must exist in the SSH config list (§4).
  - `none`: 400.
- `POST /api/home/resources/import/ssh` `{aliases:[...]}` → creates one `kind: server, check: ssh` file per alias
  that has no resource yet (title from the GPU board label when known, body template with 用途/使用方法/限制).
  Returns `{created:[ids], skipped:[aliases]}`.
- `POST /api/home/resources/import/profile` `{profileId, resourceId?}` → for a launch profile, creates (or updates)
  an `api` resource whose `env` are the profile's non-empty secret-looking variables
  (`*_KEY`, `*_TOKEN`, `*_SECRET`) and stores those values as secrets; non-secret ones such as `ANTHROPIC_BASE_URL`
  become `base_url`. Never returns values.
- `GET /api/home/servers` → `{servers:[ServerStatus], sshAliases:[...], board:{available, collectedAt, staleAfterSeconds, url}}`.
  `sshAliases` = concrete `Host` names from `~/.ssh/config` and its `Include`d files (no wildcards, no other fields).
  `ServerStatus = {id, alias, group, label, state: fresh|stale|disconnected|unknown|unsupported, reachability, telemetry,
  lastSuccessAt, lastMetricsAt, ageSeconds, errorCode, gpus:[{index, name, memoryTotalMib, memoryUsedMib, utilizationPct,
  temperatureC, powerW, migMode, observation: low_usage|usage_observed|unknown}], resourceId|null}`.
  Built from the GPU board snapshot with exactly the board's own `public_snapshot` allowlist and state rules
  (stale after 180 s; no identity, UUID, address, user name or stderr). Unknown/missing snapshot → `board.available=false`.
- `GET /api/home/projects/{id}/resources` → resources whose `projects` include `*` or the id, plus the project's
  `defaultResources` (from `pantheon.json` key `resources: [ids]`, editable via the existing meta PATCH).

Config: `--gpu-board-snapshot` (default `~/projects/atombit-gpu-board/runtime/snapshot.json`),
`--gpu-board-url` (default empty; when set, the UI links to it).

## 4. Using resources

- **Sessions**: `POST /api/home/projects/{id}/sessions` accepts `resources: [ids]` (default = the project's
  `defaultResources`). For each allowed resource, every configured secret is passed to the new tmux session
  as an environment variable with the existing `-e` mechanism, together with `PANTHEON_RESOURCES=<comma ids>`.
  A resource not allowed for the project → 403. One `resource_uses` row per resource.
- **Project manager**: the discussion prompt gains a "可用资源" section: for each allowed resource its id, kind, title,
  env names, ssh alias, server state (with GPU summary when fresh) and the first 1 KiB of its usage body — never values.
  New suggestion type `{"type":"use_resources","resources":[ids]}` → UI offers "以这些资源新建会话".
- **Agents in any project** can read the resource files directly from the Harness (`pantheon/resources/`) for usage
  instructions. The generated `pantheon/resources/README.md` index (written on every resource create/update/delete) lists
  id, kind, title, env names and one-line purpose, so it is a stable entry point.

## 5. Frontend

- Route `/home/resources` (base-path aware) and a "资源" entry in the home header next to the view switcher; also
  reachable from the project page info tab.
- Resources page: kind filter (全部 / API / 服务器 / 数据集 / 账号 / 服务 / 其他), search, "新建资源", "导入 SSH 主机",
  "从启动配置导入". Card grid on wide, list on narrow.
  - API card: title, provider, env names with configured dots, last check (ok/failed, time, model count), buttons
    设置密钥 (dialog with one password field per env name; shows 已配置 · 更新时间; never pre-fills), 检测.
  - Server card: label/alias, state chip (fresh green, stale yellow, disconnected red, unknown gray), last seen,
    per-GPU rows with memory bar and utilization %, "低占用" badge only for `low_usage` with the note
    "仅观察，不代表可分配"; buttons 检查连接 (ssh check), 打开调度面板 (when configured).
  - Other kinds: title, url, tags, check button when `check: http`.
  - Detail page/drawer `/home/resources/<id>`: editable fields (kind-specific), project scope multi-select
    (全部项目 or chosen ids), tags, usage doc editor (textarea with markdown preview), secrets section, checks history,
    recent uses, delete with ConfirmDialog.
- Server overview section at the top of the resources page when kind = 全部 or 服务器: group summary
  (atombit / hospital / zdq / ai4s: connected count, fresh GPU count, low-usage count), and a "快照时间" with stale warning.
- Project page info tab: "可用资源" chips and a "默认会话资源" multi-select (meta PATCH `resources`).
  Session tab "新建会话" dialog gets resource checkboxes preselected from the defaults.
- Chat: render `use_resources` suggestion chip.
- Same capabilities on phone; no page-level horizontal scroll at 360 px. i18n `home.res.*` zh/en; existing tokens,
  `vp-control`, `ConfirmDialog`, `safeText`; secret inputs `type=password autocomplete=off`.

## Tests

Backend: resource file parse/write/rev/409/byte preservation; README index generation; secrets seal/unseal round-trip
and that no response body ever contains a stored value (scan every JSON response in the tests); orphan detection;
provider check against an `httptest` server for anthropic and openai shapes incl. redaction of the key in errors;
http check; ssh check with a fake `ssh` on PATH; SSH config alias parsing with Include and wildcards; GPU snapshot
projection drops identity/uuid and applies stale rules with a fixed clock; import from ssh and from profile;
session creation injects env and writes uses, 403 for a disallowed resource; prompt contains resource summary but no
values; allow-list; `TestTheAPIDocCoversEveryRoute`.
Frontend: vitest for helpers (kind filters, server group summary, state→chip mapping, secret dialog state, scope
selection, route parsing).
