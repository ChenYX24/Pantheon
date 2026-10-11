import type { HomeExecution, HomeRun } from '../../protocol/home'

export const runFixture: HomeRun = {
  id: 'run_1', projectId: 'pantheon', taskId: 'E1', attempt: 1, state: 'running',
  harness: 'codex', model: 'gpt-6-astra', reviewer: 'claude/claude-opus-5-5',
  branch: 'pantheon/E1', worktree: '/runs/pantheon/run_1', sessionId: 'vp_run1',
  baseCommit: '1234567890abcdef', headCommit: '', startedAt: 1791633600, finishedAt: 0,
  summary: '', checks: [],
}
export const executionFixture: HomeExecution = { flag: 'allow', enabled: true, maxRuns: 2, active: [] }
