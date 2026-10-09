import type { HomeFieldSettings, HomeProject, HomeTaskRow } from '../../protocol/home'

export const taskFixture: HomeTaskRow = {
  projectId: 'pantheon', id: 'A2', title: 'Backend', status: 'awaiting_approval', stage: 'A',
  primary: 'codex/gpt-6-astra', secondary: '', dependsOn: ['A1'], session: 'vp_1', blockedReason: '',
  sessionStatus: 'rollover_due', updated: '2026-10-09T12:00:00Z', handoffs: 2, body: 'Review the backend.',
  rev: 'abc', file: 'task.md', priority: 'P1', tags: ['backend', 'review'], owner: 'cyx', due: '2026-10-12',
}
export const projectFixture: HomeProject = {
  id: 'pantheon', aliases: ['parthenon'], portfolio: 'agent-platform', category: 'product', status: 'active',
  path: '/checkout', pathExists: true, panelProjectId: null, goal: 'Build the home view', activeDocs: [], lastVerified: '', blockers: ['Review needed'],
  taskCounts: { planned: 1, in_progress: 0, awaiting_review: 1, awaiting_approval: 0, blocked: 0, done: 1, cancelled: 0, total: 3 },
  stages: [{ name: 'A', done: 1, total: 3 }], latestReport: { file: 'review.md', title: '<script>not markup</script>', summary: 'Review ready', at: '', kind: 'report', needsUser: false },
  sessions: [{ id: 'vp_1', name: 'Terminal', state: 'waiting', agent: 'codex', stateChangedAt: '' }], usage: { known: false }, updatedAt: '2026-10-09T12:00:00Z',
  meta: { labels: ['product'], priority: 'P0', phase: 'development', owner: 'cyx', pinned: false }, metaRev: 'meta-rev',
}
export const fieldsFixture: HomeFieldSettings = {
  rev: 'fields-rev',
  fields: {
    task: { status: { options: [{ value: 'awaiting_approval', label: 'Awaiting approval', color: 'orange' }] }, priority: { options: [{ value: 'P1', color: 'orange' }] }, tags: { options: [{ value: 'backend', color: 'purple' }] } },
    project: { labels: { options: [{ value: 'product', color: 'blue' }] }, priority: { options: [{ value: 'P0', color: 'red' }] }, phase: { options: [{ value: 'development', color: 'blue' }] } },
  },
}
