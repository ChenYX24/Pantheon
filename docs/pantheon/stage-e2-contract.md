# Pantheon stage E2 contract — session rollover instead of killing

Status: frozen for task E2a (backend + its small UI hooks), 2026-10-11.

User decision (2026-10-11): under memory pressure the panel must prefer sessions that
are **not working**, and must never just kill an agent: it first asks the agent to write
a handoff document, then ends the session, so the work can continue in a fresh session.
The same mechanism is the "long session → summarise → new session" rollover.

Evidence: the shared session pool (`vibepanel-sessions-<uid>.scope/pool`, ≈1.7 GB on this
3.5 GB host, no swap) recorded 19 kernel OOM kills; the busiest agent session alone 17.

## 1. Rollover primitive

`POST /api/sessions/{id}/rollover` body `{reason: "manual"|"memory"|"long", resume: bool}`
(authenticated; in development allowed where manual sessions are). Steps:

1. Handoff path: if the session's panel project path equals a cyx checkout (stage A
   index), `<harness>/projects/<cyx-id>/agent-docs/handoffs/<YYYY-MM-DD-HH-MM>-<session-id>.md`;
   otherwise `<data-dir>/handoffs/<session-id>-<ts>.md`. Create the directory.
2. If the pane runs a known agent (Claude Code or Codex, from the existing detector /
   launch command), type into the pane (existing safe-input path, bracketed paste, then
   Enter) exactly one message:
   `[Pantheon] 需要结束本会话（原因：<中文原因>）。请立即把当前工作写成交接文档，保存到 <path>，包含：目标、已完成、未完成、关键文件与命令、下一步、注意事项。写完后只回复 HANDOFF-DONE，不要做别的事。`
   If the agent is mid-turn (state `working`), wait until it is `waiting`/`done` or 60 s,
   then send.
3. Wait for completion: the file exists, is ≥ 200 bytes and unchanged for 5 s, **or** the
   pane shows `HANDOFF-DONE`, up to `graceSeconds` (default 180). For `reason: memory`,
   stop waiting early if the host reaches the critical level (`Available < reserve/2`).
4. If no file was written (timeout, or not an agent), write a fallback handoff with: session
   title, project, cwd, launch command, last 200 lines of scrollback (existing capture),
   `git -C <cwd> status --short` and `git log --oneline -5` when it is a repo, and the reason.
   Mark it `generated_by: pantheon (agent did not answer)`.
5. End the session's processes: SIGTERM to the pane process group, SIGKILL after 10 s
   (reuse the governor's kill helper and its safety checks). Archive the session with a
   note `rolled over → <path>` (keep its row and scrollback).
6. Record: a session event, and a Harness report (cyx projects only)
   `agent-docs/reports/<ts>-rollover-<session>.md` (`kind: report`, `needs_user: false`,
   summary: reason, freed memory, handoff path).
7. If `resume`: create a new session in the same panel project with the same launch
   profile/command, and once it is ready type
   `请先阅读交接文档 <path>，确认理解后从“下一步”继续。` Return `{handoff, newSessionId?}`.

At most one rollover per session at a time; a second request returns 409. Rollover state
is visible through `GET /api/sessions/{id}/rollover` → `{state: idle|asking|waiting|ending|done|failed, handoff, startedAt, error}`.

## 2. Governor: idle first, rollover instead of kill

Policy gains (persisted with the existing resource policy, defaults in brackets):
`rollover` [true], `idleMinutes` [10], `rolloverGraceSeconds` [180], `autoResume` [false].

When the governor would today name a culprit and (after grace) end a process:

- Candidates are sessions in the pool, excluding: home execution workers (`home-worker`
  sessions), `Priority` high/pinned sessions, and sessions already rolling over.
- **Idle** = detector state `waiting` or `done` for ≥ `idleMinutes`, or state unknown with
  CPU < 2 % over the last minute. Prefer idle candidates, largest `Held` first. Only when
  no idle candidate exists may a working session be chosen (existing growth/size rule).
- With `rollover: true` the automatic action is the §1 rollover (`reason: memory`,
  `resume: autoResume`) instead of killing; the existing alert shows "正在交接 <title>" with
  the countdown. Working sessions chosen as a last resort still get the rollover message
  first (the agent can save its state), but the wait is capped at `min(grace, 60 s)`.
- If several idle sessions are needed, roll them over one at a time, re-assessing after each.
- With `rollover: false` behaviour is unchanged.

## 3. Long sessions

Optional per-project setting in `pantheon.json` (meta PATCH): `rolloverAfterHours`
(0 = off, default 0). When an idle agent session in that project has run longer than that,
the home to-do list shows `session_rollover` for it (stage A kind) with actions
"交接并新开" (`resume: true`) — never automatic.

## 4. UI hooks (small; the main redesign is F1)

- Home project page, Sessions list: each agent session gets "交接并结束" and "交接并新开"
  (ConfirmDialog), with live rollover state.
- Terminal panel: same two actions in the session's menu (existing `Menu.tsx`).
- Settings → resources: the four policy fields.
- i18n zh/en.

## Tests

Path selection (cyx vs data dir); agent message text; completion by file / by marker /
timeout fallback content; process ending order; archive note; report file; resume creates a
session and types the prompt; 409 on concurrent rollover; governor picks idle over working,
skips home workers and pinned, uses rollover when enabled and kill when disabled, one at a time,
critical level shortens the wait. Use fake panes/tmux helpers already used by the
resources and httpapi tests; never touch a real user session.
