import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import { HomeCard } from './HomeCard'
import { HomeTable } from './HomeTable'
import { HomeProjectPage } from './HomeProjectPage'
import { HomeReports } from './HomeReports'
import { viewFromSearch } from './board'
import { fieldsFixture, projectFixture, taskFixture } from './fixtures'

vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
const language = getLang()
afterEach(() => setLang(language))

describe('home view content', () => {
  it.each(['en', 'zh'] as const)('shows progress, metadata, reports, blockers and session shapes in %s', (lang) => {
    setLang(lang)
    const html = renderToStaticMarkup(createElement(HomeCard, { project: projectFixture, fields: fieldsFixture.fields, onNavigate: vi.fn(), onPin: vi.fn() }))
    expect(html).toContain(t('home.usageUnknown'))
    expect(html).toContain(t('home.blockers'))
    expect(html).toContain('aria-valuenow="33"')
    expect(html).toContain('role="img"')
    expect(html).toContain('/?session=vp_1')
    expect(html).toContain('/home/p/pantheon')
    expect(html).toContain('report=review.md')
    expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;')
    expect(html).toContain('product')
    expect(html).toContain('P0')
    expect(html).toContain(t('home.pin'))
    expect(html).not.toContain('<script>')
  })

  it('renders the same editable task fields in table and card rows without writes', () => {
    const onChanged = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeTable, {
      projects: [projectFixture], tasks: [taskFixture], todos: [], settings: fieldsFixture,
      state: viewFromSearch('?view=table&group=stage'), onState: vi.fn(), onChanged, onNavigate: vi.fn(), target: 'A2', projectId: 'pantheon',
    }))
    expect(html).toContain('home-table-row')
    expect(html).toContain('home-table-card')
    expect(html).toContain(t('home.groupCount', { group: 'A', count: 1 }))
    expect(html).toContain(t('home.todo.session_rollover'))
    for (const value of ['P1', 'backend', '2026-10-12', 'codex/gpt-6-astra']) expect(html).toContain(value)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('offers five page tabs and opens a linked task without a side-sheet dialog', () => {
    setLang('en')
    const html = renderToStaticMarkup(createElement(HomeProjectPage, {
      selection: { projectId: 'pantheon', taskId: 'A2', tab: 'tasks' }, settings: fieldsFixture, state: viewFromSearch(''),
      onState: vi.fn(), onTab: vi.fn(), onThread: vi.fn(), onChanged: vi.fn(), onNavigate: vi.fn(),
    }))
    for (const tab of ['chat', 'tasks', 'reports', 'sessions', 'info'] as const) expect(html).toContain(t(`home.tab.${tab}`))
    expect(html).toContain('id="home-tab-tasks" type="button" role="tab" aria-selected="true"')
    expect(html).toContain('home-project-page')
    expect(html).not.toContain('aria-modal="true"')
  })

  it('renders question reply controls and sanitized existing replies', () => {
    const onReply = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeReports, {
      projectId: 'pantheon', target: 'question.md', active: true, busy: false, onReply, onNavigate: vi.fn(),
      reports: [{ file: 'question.md', title: 'Question', summary: 'Choose', body: 'Question body', task: 'A2', kind: 'question', needsUser: true, at: '', rev: 'r1', replies: [{ at: '', text: 'hello\u202Eworld' }] }],
    }))
    expect(html).toContain('<textarea')
    expect(html).toContain(t('home.reply'))
    expect(html).toContain('hello�world')
    expect(html).not.toContain('\u202E')
    expect(onReply).not.toHaveBeenCalled()
  })
})
