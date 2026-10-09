import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import type { HomeProject, HomeTask } from '../../protocol/home'
import { HomeCard } from './HomeCard'
import { HomeTasks } from './HomeTasks'
import { HomeProjectView } from './HomeProjectView'

const language = getLang()
afterEach(() => setLang(language))
const project: HomeProject = {
  id: 'pantheon', aliases: ['parthenon'], portfolio: 'agent-platform', category: 'product', status: 'active',
  path: '/checkout', pathExists: true, panelProjectId: null, goal: 'Build the home view', activeDocs: [], lastVerified: '', blockers: ['Review needed'],
  taskCounts: { planned: 1, in_progress: 0, awaiting_review: 1, awaiting_approval: 0, blocked: 0, done: 1, cancelled: 0, total: 3 },
  stages: [{ name: 'A', done: 1, total: 3 }], latestReport: { file: 'review.md', title: '<script>not markup</script>', summary: 'Review ready', at: '', kind: 'report', needsUser: false },
  sessions: [{ id: 'vp_1', name: 'Terminal', state: 'waiting', agent: 'codex', stateChangedAt: '' }], usage: { known: false }, updatedAt: '',
}

describe('home view content', () => {
  it.each(['en', 'zh'] as const)('shows progress, reports, blockers, session shapes and unknown usage in %s', (lang) => {
    setLang(lang)
    const html = renderToStaticMarkup(createElement(HomeCard, { project, onNavigate: vi.fn() }))
    expect(html).toContain(t('home.usageUnknown'))
    expect(html).toContain(t('home.blockers'))
    expect(html).toContain('aria-valuenow="33"')
    expect(html).toContain('role="img"')
    expect(html).toContain('/?session=vp_1')
    expect(html).toContain('report=review.md')
    expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders task stages and current statuses without issuing any writes', () => {
    const onStatus = vi.fn()
    const onCreate = vi.fn()
    const task: HomeTask = { id: 'A2', title: 'Backend', status: 'awaiting_approval', stage: 'A', primary: '', secondary: '', dependsOn: ['A1'], session: 'vp_1', blockedReason: '', sessionStatus: 'rollover_due', updated: '', handoffs: 2, body: '', rev: 'abc', file: 'task.md' }
    const html = renderToStaticMarkup(createElement(HomeTasks, { tasks: [task], target: 'A2', active: true, busy: false, onStatus, onCreate }))
    expect(html).toContain('value="awaiting_approval" selected=""')
    expect(html).toContain(t('home.stage', { name: 'A' }))
    expect(html).toContain(t('home.todo.session_rollover'))
    expect(onStatus).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('offers all four tabs and opens a linked task directly', () => {
    setLang('en')
    const html = renderToStaticMarkup(createElement(HomeProjectView, { selection: { projectId: 'pantheon', taskId: 'A2' }, onClose: vi.fn(), onChanged: vi.fn(), onNavigate: vi.fn() }))
    for (const tab of ['chat', 'tasks', 'reports', 'sessions'] as const) expect(html).toContain(t(`home.tab.${tab}`))
    expect(html).toContain('id="home-tab-tasks" type="button" role="tab" aria-selected="true"')
    expect(html).toContain('aria-modal="true"')
  })
})
