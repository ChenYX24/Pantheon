# Stage R contract — automatic session rollover by context use

Status: R0 contract, user-approved design 2026-10-16. R1 (the meter) is implemented; R2/R3 implement the rest.
Plan: Harness `plan/Pantheon自动换会话计划_2026-10-16-14-47.md`.

## 1. Principle
A rollover never interrupts work. Reaching the threshold only marks a session *due*; the
switch happens at a natural boundary, with the user able to cancel at every step. State
lives in the handoff file, not in either session. The old session is released only after
the new one confirms; release archives (restorable), it never deletes.

## 2. Usage (R1, done)
`context[sessionId] = {used, window, model, source, at}` in the socket snapshot (`internal/agentctx`).
`used` = tokens of the last main-chain request (Claude: input + cache_read + cache_creation;
Codex: `last_token_usage.input_tokens`). `window` 0 = unknown: no percentage, never due.
Unknown is not zero. Rounded to 1k so the snapshot does not churn.

## 3. Policy (settings; defaults)
| key | default |
|---|---|
| `rollover.auto.enabled` (global; per-session off switch) | true |
| `rollover.auto.thresholdPct` | 70 |
| `rollover.auto.countdownSeconds` | 30 |
| `rollover.auto.keepOldMinutes` | 10 |
| `rollover.auto.idleInputSeconds` | 120 |
Only panel-started sessions with a recorded claude/codex LaunchCommand are eligible. Per
session: at most 3 automatic rollovers per 24 h; after a cancel, due again at threshold + 10 %.
Memory-pressure rollover (E2 governor) keeps its own rules and takes precedence.
The switch, the per-session off and the daily cap restrain the *automatic* trigger only. An
explicit request (the header's Hand off button, `POST …/rollover/auto {"action":"now"}`) is a
person's decision: it works with the switch off, with "never" set and past the cap, and is
remembered across polls. It is still refused for an ineligible or busy session, still waits
for the boundary, still counts down, and a keystroke still cancels it.

## 4. State machine (per session, in memory; derived from files, not stored)
`ok → due → countdown → handing_off → verifying → handed_off → released`
side exits: `cancelled` (back to ok, postponed), `failed` (old session kept, to-do raised).

- **due**: pct ≥ threshold. Meter turns amber; a line under the header says the session will be
  handed over after this turn, with [now] [later] [never for this session].
- **boundary** (all must hold to leave *due*): session state is done/idle (not working,
  not waiting on a permission/choice/question); no browser input to the session for
  `idleInputSeconds` and no unsent compose draft; no background sub-agent or long command
  known to be running. If any stops holding, wait; usage rising meanwhile does not hurry it.
- **countdown**: `countdownSeconds`, banner with [cancel]. Any keystroke into the session
  cancels and postpones. Nothing typed is lost.
- **handing_off**: handoff prompt (existing primitive); required sections: 目标 / 已完成 /
  未完成 / 下一步 / 验证命令 / 禁止事项. A missing section is asked for once, then the file is
  generated from the last 200 lines + git status and labelled as a fallback.
- **verifying**: new session opened with the same LaunchCommand in the same project and sidebar
  slot, title kept with a "↻" mark, told to read the handoff, restate "下一步", and report
  with `vibepanel me` (summary + label `handoff-ack`). Old session untouched.
- **handed_off**: ack seen. If the user was viewing the old session the view moves to the
  new one with a toast [back to old] [release]. Otherwise a quiet home notification.
- **released**: after `keepOldMinutes`, or on [release]: scrollback saved, session archived with
  note `rolled over → <handoff path>`, tmux freed. [back to old] cancels the timer.
- **failed**: no ack after 10 min, new session failed to start, or handoff unreadable →
  old session stays as it was; home to-do "check the handover"; nothing is killed.

## 5. Signals
- Claude `PreCompact` hook (installed with the other hooks, string kept in step with red line 3):
  marks *due* regardless of threshold; it never blocks compaction. Codex has no equivalent.
- Hooks absent: the poller's transcript/rollout reading (R1) still drives usage.

## 6. Audit and UI
Events `rollover.due|countdown|cancelled|handed_off|released|failed` (session, pct, reason).
i18n zh/en; non-colour cue for the amber/red bands; phone shows the banner, not the header meter.

## 7. Out of scope
Changing the agent's own compaction; Codex native resume; token-based triggers for
non-interactive E1 workers (each attempt is already a fresh process).
