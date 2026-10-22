# Stage R contract — automatic session rollover by context use

Status: R0 contract, user-approved design 2026-10-16. R1 (the meter) and R2 (the trigger) are
implemented; R3 (confirm before release) is specified in §8, which settles what §4 left open.
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
- **boundary, without hooks**: a Claude with no hook reporting is read from its transcript:
  the last main-chain assistant entry having `stop_reason: end_turn` counts as done, but only
  over the panel's own guess (never over a hook or a bell), and the two-minute quiet gate
  still applies. A Claude hook state stored in the database is not restored at startup when
  Claude's hooks are not installed, because nothing could ever replace it.
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

## 8. R3: the replacement confirms before the old session is released (2026-10-22)

Until R3 the primitive ended the old session first and opened the new one after. A handoff that
failed after that point (2026-10-20: the replacement never became ready) left nothing running and
nobody told. R3 reverses the order, so every failure leaves the old session exactly as it was.

**Which rollovers.** Every rollover that opens a replacement (`resume: true`) for any reason but
`memory`: the automatic trigger, the Hand off button, and `POST …/rollover` with `manual`/`long`.
Memory pressure keeps the E2 order (end first, then open), because its point is to free memory now;
so does `resume: false`, which has no replacement to wait for.

**The handoff document.** The prompt asks for Markdown headings 目标 / 已完成 / 未完成 / 下一步 /
验证命令 / 禁止事项 (关键文件与命令 is invited, not required). A section is present when some
heading line (`#`…) contains its name. When the reply leaves some out, the agent is asked once,
by name, for those sections. If they are still missing the agent's text is kept and a labelled
appendix is added below it (`## Pantheon fallback` with the missing names, the last 200 lines and
`git status`/`git log`). The agent's words are never replaced. No document at all is the E2
fallback, as before.

**Order.**
1. Handoff written and checked (above); the old session's scrollback saved.
2. Replacement created: same project, directory, launch command, profile, account and size; title
   and pin copied. Ready as before (a hook's waiting/done, or drawn and then still for 5 s; at most
   60 s).
3. Ack prompt pasted into the replacement (below). Both sessions are now **verifying**.
4. Ack seen → **handed_off**. Old session released after `keepOldMinutes`, or at once on *release*.
5. No ack within **10 minutes** of the prompt, or the replacement exits or fails to start →
   **failed**. Both sessions stay as they are; nothing is ended.

**Ack prompt** (pasted into the replacement, one line):
`[Pantheon] 你接手了上一个会话。请先阅读交接文档 <path>，然后：1）用一句话复述其中的“下一步”，执行 vibepanel me info set summary "<复述>"；2）执行 vibepanel me info set labels handoff-ack（vibepanel 命令不可用时，改为单独输出一行 HANDOFF-ACK）；3）从“下一步”继续。`

**What counts as the ack.** Either the replacement's labels contain `handoff-ack` (written through
`vibepanel me`, which only that session's own token can do), or a line that is exactly
`HANDOFF-ACK` appears on the replacement's screen after the prompt (an agent whose sandbox cannot
reach the panel). The restated next step is the replacement's summary; it goes into the
`rollover.handed_off` audit detail, truncated to 200 characters. The panel does not judge the
restatement. The person sees it.

**Views** (`rollover[sessionId]` in the snapshot, extended):
| session | state | extra fields |
|---|---|---|
| old | `verifying` | `newSessionId` |
| old | `handed_off` | `newSessionId`, `endsAt` = release deadline |
| old | `failed` | `newSessionId` when one was opened |
| new | `verifying` | `replaces` |
| new | `confirmed` | `replaces`; lasts until the old session is released or kept |

**Release.** At the deadline or on *release*: fresh scrollback, end through the governor's
prepared end, archive with `rolled over → <path>`, exit, done, execution report. These are the
existing steps, moved after the ack. If the governor raises a memory alert while a session is
`handed_off`, it is released at once.

**Keeping the old session.** *keep* (the toast's "back to old"), or any keystroke into the old
session once the replacement exists, cancels the release. Both sessions stay as ordinary
sessions. That is the person deciding, and typing into the old one is the clearest way they can
say so. "Once the replacement exists", not "after the ack": counting only later keystrokes
released an old session ten minutes after the ack while it was answering what the person had
asked it during verification, which is the interruption §1 rules out.

A keystroke is what the session itself counts as one (`session.Live.Write`'s `OnKey`: anything
that does not start with an escape sequence, and a line), or a paste. What a terminal sends on
its own is not: focus in/out, answers to an application's queries, mouse and wheel reports.
They used to count, and they are the one path found that explains the first real Claude handoff
on /dev (2026-10-22): its old session was kept for "input" with nothing on its screen typed.
Arrow keys and a lone Esc are left out with them, as `OnKey` already does.

**Busy.** While a pairing is live (verifying, handed_off/confirmed), neither session can start
another rollover, and the governor does not pick either of them as a rollover candidate.

**Restart.** Pairing state is in memory. A restart during a pairing ends it with both sessions
alive. That costs one extra session until the person archives it, and it can never end the only
copy of the work.

**Failure is reported.** `rollover.failed` audit, the old session's strip says why with a link to
the replacement, and for a cyx project an execution report with `needs_user` (the home page's
"check the handover" to-do).

**Routes.** `POST /api/sessions/{id}/rollover/auto` gains `release` (old session in `handed_off`)
and `keep` (old session in `verifying` or `handed_off`). Anything else is 409.

**Browser.**
- Old session strip: verifying "↻ 新会话正在确认交接 [打开新会话]"; handed_off "已交接到新会话 ·
  m:ss 后释放旧会话 [打开新会话] [保留旧会话] [立即释放]"; failed "交接未确认：<reason>
  [打开新会话]".
- New session strip: verifying "↻ 正在接手：阅读交接文档"; confirmed "↻ 已确认交接：<summary>".
- The person viewing the old session when it becomes `handed_off` is moved to the new one, once
  per pairing, with a toast [回到旧会话] (select old and *keep*) [释放]. Anyone not viewing it is
  not interrupted.
- A sidebar row whose view has `replaces` shows "↻": shape, not colour (red line 4).

**Audit.** `rollover.handed_off` (session, newSessionId, summary), `rollover.released`,
`rollover.cancelled` with reason `keep` or `input`, and `rollover.failed`.
