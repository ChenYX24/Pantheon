import { afterEach, describe, expect, it } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import { HOME_RUN_STATES } from '../../protocol/home'
import { activeRun, autonomyDraft, autonomyError, autonomyPatch, executionState, runChip, runDuration, runSeconds, taskRunReason, taskStages, toggleApprovedStage } from './execution'
import { executionFixture, runFixture } from './executionFixtures'
import { projectFixture, taskFixture } from './fixtures'

const language = getLang()
afterEach(() => setLang(language))
const planned = { ...taskFixture, status: 'planned' as const, dependsOn: [] }

describe('execution eligibility explanations', () => {
  it.each(['en', 'zh'] as const)('distinguishes unknown, flag off and switched off in %s', (lang) => {
    setLang(lang)
    const cases = [
      [null, 'unknown'], [{ ...executionFixture, flag: 'off' as const }, 'flagOff'],
      [{ ...executionFixture, enabled: false }, 'switchedOff'],
    ] as const
    for (const [execution, state] of cases) {
      expect(executionState(execution)).toBe(state)
      expect(taskRunReason(planned, projectFixture, execution, [])).toBe(t(`home.exec.reason.${state}`))
    }
    expect(executionState(executionFixture)).toBe('on')
  })

  it('allows a manual start with autonomy off or an unapproved stage', () => {
    for (const autonomy of ['off', 'stage', 'full'] as const) {
      const project = { ...projectFixture, meta: { ...projectFixture.meta, autonomy, approvedStages: [] } }
      expect(taskRunReason(planned, project, executionFixture, [])).toBe('')
    }
  })

  it('requires a planned task and an existing checkout', () => {
    expect(taskRunReason(taskFixture, projectFixture, executionFixture, [])).toBe(t('home.exec.reason.notPlanned'))
    for (const project of [undefined, { ...projectFixture, pathExists: false }, { ...projectFixture, path: '' }]) {
      expect(taskRunReason(planned, project, executionFixture, [])).toBe(t('home.exec.reason.checkout'))
    }
  })

  it('treats reviewing as active and distinguishes project ownership from instance capacity', () => {
    for (const state of ['running', 'reviewing'] as const) {
      const run = { ...runFixture, state }
      expect(taskRunReason(planned, { ...projectFixture, activeRun: run }, executionFixture, [])).toBe(t('home.exec.reason.projectBusy'))
      expect(taskRunReason(planned, projectFixture, { ...executionFixture, active: [run] }, [])).toBe(t('home.exec.reason.projectBusy'))
      expect(taskRunReason(planned, projectFixture, { ...executionFixture, maxRuns: 1, active: [{ ...run, projectId: 'another' }] }, [])).toBe(t('home.exec.reason.capacity', { count: 1 }))
    }
    expect(taskRunReason(planned, projectFixture, { ...executionFixture, active: [{ ...runFixture, state: 'accepted' }] }, [])).toBe('')
  })

  it('requires all dependencies, including missing ones, to be done', () => {
    const task = { ...planned, dependsOn: ['A1', 'missing\u202E'] }
    expect(taskRunReason(task, projectFixture, executionFixture, [{ ...planned, id: 'A1', status: 'cancelled' }])).toBe(t('home.exec.reason.dependencies', { tasks: 'A1, missing�' }))
    expect(taskRunReason({ ...task, dependsOn: ['A1'] }, projectFixture, executionFixture, [{ ...planned, id: 'A1', status: 'done' }])).toBe('')
  })
})

describe('run states and clocks', () => {
  it.each(['en', 'zh'] as const)('gives all eight states a label and a distinct glyph in %s', (lang) => {
    setLang(lang)
    expect(new Set(HOME_RUN_STATES.map((state) => runChip(state).icon)).size).toBe(8)
    for (const state of HOME_RUN_STATES) {
      const chip = runChip(state)
      expect(t(chip.label)).not.toBe(chip.label)
      expect(chip.color).toBeTruthy()
      expect(activeRun(state)).toBe(['running', 'reviewing'].includes(state))
    }
  })

  it('ticks active runs, freezes finished runs and handles both home timestamp formats', () => {
    const start = Number(runFixture.startedAt) * 1000
    expect(runSeconds(runFixture, start + 12999)).toBe(12)
    expect(runSeconds({ ...runFixture, state: 'reviewing' }, start + 20000)).toBe(20)
    expect(runSeconds({ ...runFixture, state: 'accepted', finishedAt: Number(runFixture.startedAt) + 60 }, start + 999999)).toBe(60)
    expect(runSeconds({ state: 'merged', startedAt: '2026-10-10T12:00:00+08:00', finishedAt: '2026-10-10T04:02:00Z' }, 0)).toBe(120)
    expect(runSeconds(runFixture, start - 1000)).toBe(0)
    expect(runSeconds({ ...runFixture, startedAt: 'bad' }, start)).toBeNull()
    expect(runSeconds({ ...runFixture, state: 'failed' }, start + 999999)).toBeNull()
    expect(runSeconds({ ...runFixture, startedAt: 0 }, start)).toBeNull()
  })

  it.each(['en', 'zh'] as const)('formats duration boundaries in %s', (lang) => {
    setLang(lang)
    const start = Number(runFixture.startedAt) * 1000
    expect(runDuration(runFixture, start + 59000)).toBe(t('home.exec.duration.seconds', { seconds: 59 }))
    expect(runDuration(runFixture, start + 61000)).toBe(t('home.exec.duration.minutes', { minutes: 1, seconds: 1 }))
    expect(runDuration(runFixture, start + 3661000)).toBe(t('home.exec.duration.hours', { hours: 1, minutes: 1 }))
    expect(runDuration({ ...runFixture, startedAt: '' }, start)).toBe('—')
  })
})

describe('autonomy form state', () => {
  it('uses contract defaults and submits camelCase fields with the displayed revision', () => {
    const draft = autonomyDraft({}, 'seen')
    expect(autonomyPatch(draft)).toEqual({ rev: 'seen', autonomy: 'off', approvedStages: [], autoMerge: false, maxAttempts: 2, attemptMinutes: 30 })
    const edited = { ...draft, autonomy: 'full' as const, maxAttempts: '3', attemptMinutes: '120', autoMerge: true }
    expect(edited.originalAutonomy).toBe('off')
    expect(autonomyPatch(edited)).toMatchObject({ rev: 'seen', autonomy: 'full', autoMerge: true, maxAttempts: 3, attemptMinutes: 120 })
    expect(autonomyPatch(edited)).not.toHaveProperty('verifyScope')
  })

  it('keeps absent stage approvals and leaves the polled metadata untouched', () => {
    const meta = { ...projectFixture.meta, autonomy: 'stage' as const, approvedStages: ['old', 'A'] }
    const draft = autonomyDraft(meta, 'old-rev')
    draft.approvedStages = toggleApprovedStage(draft.approvedStages, 'A')
    expect(draft.approvedStages).toEqual(['old'])
    expect(toggleApprovedStage(draft.approvedStages, 'B')).toEqual(['old', 'B'])
    expect(meta.approvedStages).toEqual(['old', 'A'])
    expect(taskStages([{ ...planned, stage: 'B' }, { ...planned, stage: '' }, { ...planned, stage: 'A' }, planned])).toEqual(['A', 'B'])
  })

  it('rejects empty, fractional and out-of-range numbers without coercing them into settings', () => {
    const draft = autonomyDraft({}, '')
    for (const maxAttempts of ['', '0', '4', '1.5', '-1', 'NaN']) {
      expect(autonomyError({ ...draft, maxAttempts })).toBe(t('home.exec.attemptsRange'))
      expect(autonomyPatch({ ...draft, maxAttempts })).toBeNull()
    }
    for (const attemptMinutes of ['', '4', '121', '5.5', 'Infinity']) expect(autonomyError({ ...draft, attemptMinutes })).toBe(t('home.exec.minutesRange'))
    expect(autonomyError({ ...draft, maxAttempts: '1', attemptMinutes: '5' })).toBe('')
  })
})
