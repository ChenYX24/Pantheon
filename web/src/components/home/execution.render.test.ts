import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import { homeApi } from '../../protocol/home'
import { HomeAutonomyForm } from './HomeAutonomyForm'
import { HomeCard } from './HomeCard'
import { HomeExecution, HomeExecutionBanner } from './HomeExecution'
import { HomeExecutionStatus } from './HomeExecutionStatus'
import { HomeProjectPage } from './HomeProjectPage'
import { HomeRunChip, HomeRunLog, HomeTaskRun } from './HomeRun'
import { HomeRunHistory } from './HomeRunHistory'
import { HomeTable } from './HomeTable'
import { useHomeResource } from './useHomeResource'
import { viewFromSearch } from './board'
import { executionFixture, runFixture } from './executionFixtures'
import { fieldsFixture, projectFixture, taskFixture } from './fixtures'

const reads = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('./useHomeResource', () => ({ useHomeResource: vi.fn(() => ({ data: reads.data.shift() ?? null, loading: false, error: '', refresh: vi.fn() })) }))
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
const language = getLang()
afterEach(() => { setLang(language); reads.data = []; vi.clearAllMocks(); vi.restoreAllMocks() })

describe('execution controls in both languages', () => {
  it.each(['en', 'zh'] as const)('explains flag and runtime switches without offering a forbidden switch in %s', (lang) => {
    setLang(lang)
    const props = { error: '', busy: false, onEnabled: vi.fn(), onRetry: vi.fn() }
    const off = renderToStaticMarkup(createElement(HomeExecutionBanner, { ...props, execution: { ...executionFixture, flag: 'off' } }))
    expect(off).toContain(t('home.exec.flagOff'))
    expect(off).not.toContain('role="switch"')
    const allowed = renderToStaticMarkup(createElement(HomeExecutionBanner, { ...props, execution: { ...executionFixture, enabled: false } }))
    expect(allowed).toContain('role="switch"')
    expect(allowed).toContain(t('home.exec.switchedOff'))
    expect(allowed).not.toContain('checked=""')
    const on = renderToStaticMarkup(createElement(HomeExecutionBanner, { ...props, execution: executionFixture }))
    expect(on).toContain('checked=""')
    expect(on).toContain(t('home.exec.on', { count: 0, max: 2 }))
    const unknown = renderToStaticMarkup(createElement(HomeExecutionStatus, { execution: null }))
    expect(unknown).toContain(t('home.exec.status.unknown'))
    expect(props.onEnabled).not.toHaveBeenCalled()
  })

  it.each(['en', 'zh'] as const)('renders all autonomy settings and task stage chips in %s without saving', (lang) => {
    setLang(lang)
    const onSave = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeAutonomyForm, { project: { ...projectFixture, meta: { ...projectFixture.meta, autonomy: 'stage', approvedStages: ['A'] } }, tasks: [taskFixture, { ...taskFixture, stage: 'B\u202E' }], busy: false, onSave }))
    for (const key of ['off', 'stage', 'full'] as const) expect(html).toContain(t(`home.exec.autonomy.${key}`))
    expect(html).toContain(t('home.exec.revokeStage', { stage: 'A' }))
    expect(html).toContain(t('home.exec.approveStage', { stage: 'B�' }))
    expect(html).toContain(t('home.exec.autoMerge'))
    expect(html).toContain('min="1" max="3" step="1"')
    expect(html).toContain('min="5" max="120" step="1"')
    expect(html).not.toContain('\u202E')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders active task, executor/reviewer, elapsed time, log, terminal and stop controls', () => {
    const start = vi.spyOn(homeApi, 'runTask')
    reads.data = [[runFixture], { ...runFixture, log: '<script>\nhello\u202E', handoff: '' }]
    const html = renderToStaticMarkup(createElement(HomeExecution, {
      project: projectFixture, tasks: [{ ...taskFixture, id: 'E1', title: 'Execution task' }], execution: { ...executionFixture, active: [runFixture] }, executionError: '', onChanged: vi.fn(), onNavigate: vi.fn(),
    }))
    for (const key of ['active', 'elapsed', 'log', 'openTerminal', 'stop', 'history'] as const) expect(html).toContain(t(`home.exec.${key}`))
    for (const value of ['Execution task', 'codex/gpt-6-astra', 'claude/claude-opus-5-5', '?session=vp_run1', '&lt;script&gt;\nhello�']) expect(html).toContain(value)
    expect(html).not.toContain('<script>')
    expect(useHomeResource).toHaveBeenCalledWith(expect.any(Function), 3000)
    expect(start).not.toHaveBeenCalled()
  })

  it('keeps log newlines and neutralizes control characters inside a bounded, wrapping tail', () => {
    const html = renderToStaticMarkup(createElement(HomeRunLog, { log: 'first\r\n<script>\u202E\n' + 'x'.repeat(1000) }))
    expect(html).toContain('first\n&lt;script&gt;�\n')
    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).not.toContain('\u202E')
  })
})

describe('execution navigation and history', () => {
  it.each(['en', 'zh'] as const)('shows a labelled state glyph, accepted-only merging, and handoff links in %s', (lang) => {
    setLang(lang)
    const onMerge = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeRunHistory, {
      runs: [{ ...runFixture, state: 'accepted', headCommit: '12345678abcdef', finishedAt: Number(runFixture.startedAt) + 90 }, { ...runFixture, id: 'run_2', state: 'rejected' }], tasks: [taskFixture], busy: false, onMerge, onNavigate: vi.fn(), returnSearch: '?view=table',
    }))
    expect(html).toContain(t('home.exec.state.accepted'))
    expect(html).toContain(t('home.exec.state.rejected'))
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html).toContain('run=run_1')
    expect(html).toContain('task=E1')
    expect(html).toContain('from=view%3Dtable')
    expect(html).toContain('title="12345678abcdef">12345678')
    expect(html).toContain('@3xl:hidden')
    expect(html).toContain('max-w-full overflow-auto')
    expect(onMerge).not.toHaveBeenCalled()
    const chip = renderToStaticMarkup(createElement(HomeRunChip, { state: 'reviewing' }))
    expect(chip).toContain('<svg')
    expect(chip).toContain(t('home.exec.state.reviewing'))
  })

  it('opens the selected handoff in its task view using the run detail filename and summary', () => {
    reads.data = [{ ...runFixture, state: 'accepted', log: '', handoff: 'handoff-001.md', summary: 'Ready\nReview\u202E' }]
    const html = renderToStaticMarkup(createElement(HomeTaskRun, { projectId: 'pantheon', taskId: 'E1', runId: 'run_1' }))
    expect(html).toContain('handoff-001.md')
    expect(html).toContain('Ready\nReview�')
    reads.data = [{ ...runFixture, taskId: 'other', handoff: 'wrong.md' }]
    const wrong = renderToStaticMarkup(createElement(HomeTaskRun, { projectId: 'pantheon', taskId: 'E1', runId: 'run_1' }))
    expect(wrong).toContain(t('home.exec.runMissing'))
    expect(wrong).not.toContain('wrong.md')
  })

  it('puts a task indicator on home cards and exposes the execution phone tab', () => {
    const card = renderToStaticMarkup(createElement(HomeCard, { project: { ...projectFixture, activeRun: runFixture }, onNavigate: vi.fn() }))
    expect(card).toContain('tab=execution')
    expect(card).toContain(t('home.exec.taskRunning', { task: 'E1' }))
    expect(card).toContain('data-state="running"')
    const page = renderToStaticMarkup(createElement(HomeProjectPage, {
      selection: { projectId: 'pantheon', tab: 'execution' }, settings: fieldsFixture, state: viewFromSearch(''), onState: vi.fn(), onTab: vi.fn(), onThread: vi.fn(), onChanged: vi.fn(), onNavigate: vi.fn(),
    }))
    expect(page).toContain('id="home-tab-execution" type="button" role="tab" aria-selected="true"')
    expect(page.match(/role="tab"/g)).toHaveLength(6)
  })

  it('offers planned-row starts in table and phone cards, with a readable disabled reason', () => {
    const row = { ...taskFixture, status: 'planned' as const, dependsOn: [] }
    const props = { projects: [projectFixture], tasks: [row], todos: [], settings: fieldsFixture, state: viewFromSearch('?view=table'), onState: vi.fn(), onChanged: vi.fn(), onNavigate: vi.fn() }
    const blocked = renderToStaticMarkup(createElement(HomeTable, { ...props, execution: { ...executionFixture, enabled: false } }))
    expect(blocked).toContain(`title="${t('home.exec.reason.switchedOff')}"`)
    expect(blocked.match(/class="vp-control home-wrap-control" disabled=""/g)).toHaveLength(2)
    const ready = renderToStaticMarkup(createElement(HomeTable, { ...props, execution: executionFixture }))
    expect(ready.match(new RegExp(`>${t('home.exec.runNow')}</button>`, 'g'))).toHaveLength(2)
    expect(ready).not.toContain('home-wrap-control" disabled=""')
    const done = renderToStaticMarkup(createElement(HomeTable, { ...props, tasks: [{ ...row, status: 'done' }], execution: executionFixture }))
    expect(done).not.toContain(t('home.exec.runNow'))
  })
})
