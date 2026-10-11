import { describe, expect, it } from 'vitest'
import type { HomeProject, HomeTodo } from '../../protocol/home'
import { HOME_PATH, HOME_RESOURCES_PATH, PANEL_PATH, homeProjectLink } from '../../routes'
import { projectFixture } from '../home/fixtures'
import { activeNavigation, currentStage, navigationProjects, panelProjectLinks, projectActivity, shellLinks, shellShortcut } from './model'

const project = (id: string, patch: Partial<HomeProject> = {}): HomeProject => ({ ...projectFixture, id, ...patch })
const todo = (projectId: string): HomeTodo => ({ id: projectId, kind: 'question', projectId, title: '', detail: '', at: '', link: { projectId, taskId: '', reportFile: '', sessionId: '' } })

describe('home shell navigation', () => {
  it('selects the route before inspecting query parameters', () => {
    expect(activeNavigation(HOME_PATH, '')).toBe('overview')
    expect(activeNavigation(`${HOME_PATH}/`, '?view=table')).toBe('overview')
    expect(activeNavigation(HOME_PATH, '?view=todo')).toBe('todo')
    expect(activeNavigation(homeProjectLink({ projectId: 'pantheon' }), '?view=todo')).toBe('projects')
    expect(activeNavigation(`${HOME_RESOURCES_PATH}/api-main`, '?view=todo')).toBe('resources')
    expect(activeNavigation(PANEL_PATH, '?session=vp_1')).toBe('terminal')
    expect(shellLinks.map((link) => link.href)).toEqual([HOME_PATH, `${HOME_PATH}?view=todo`, HOME_RESOURCES_PATH, PANEL_PATH])
  })

  it('keeps pinned projects first, then sorts by activity without mutating the snapshot', () => {
    const input = [
      project('old', { updatedAt: '2026-10-09', sessions: [] }),
      project('pinned', { updatedAt: '', sessions: [], meta: { ...projectFixture.meta, pinned: true } }),
      project('session', { updatedAt: '', sessions: [{ ...projectFixture.sessions[0], stateChangedAt: '2026-10-11' }] }),
      project('report', { updatedAt: '', sessions: [], latestReport: { ...projectFixture.latestReport!, at: '2026-10-10' } }),
      project('missing', { updatedAt: 'bad', sessions: [] }),
    ]
    const original = [...input]
    const rows = navigationProjects(input, [todo('session'), todo('session'), todo('old'), todo('absent')])
    expect(rows.map(({ project }) => project.id)).toEqual(['pinned', 'session', 'report', 'old', 'missing'])
    expect(rows.map(({ count }) => count)).toEqual([0, 2, 0, 1, 0])
    expect(input).toEqual(original)
  })

  it('reports active execution, waiting, blocked and idle with explicit precedence', () => {
    const running = project('running', { activeRun: { id: 'run-1', taskId: 'A2', state: 'running', startedAt: '' } })
    expect(projectActivity(running)).toBe('running')
    expect(projectActivity({ ...running, activeRun: { ...running.activeRun!, state: 'reviewing' } })).toBe('running')
    expect(projectActivity({ ...running, activeRun: { ...running.activeRun!, state: 'accepted' } })).toBe('waiting')
    expect(projectActivity(projectFixture)).toBe('waiting')
    expect(projectActivity(project('blocked', { sessions: [] }))).toBe('blocked')
    expect(projectActivity(project('idle', { sessions: [], blockers: [] }))).toBe('idle')
  })

  it('chooses a single current stage from the configured phase or first incomplete stage', () => {
    const stages = [{ name: 'A', done: 2, total: 2 }, { name: 'B', done: 0, total: 2 }, { name: 'C', done: 0, total: 1 }]
    expect(currentStage(project('p', { stages }))?.name).toBe('B')
    expect(currentStage(project('p', { stages, meta: { ...projectFixture.meta, phase: 'C' } }))?.name).toBe('C')
    expect(currentStage(project('p', { stages: [{ name: 'empty', done: 0, total: 0 }] }))).toBeUndefined()
    expect(currentStage(project('p', { stages: stages.map((stage) => ({ ...stage, done: stage.total })) }))?.name).toBe('C')
  })

  it('links only unique API mappings, even when names and paths look similar', () => {
    const projects = [project('one', { panelProjectId: 'vp_1' }), project('two', { panelProjectId: 'vp_2' }), project('duplicate', { panelProjectId: 'vp_2' }), project('vp_3')]
    expect([...panelProjectLinks(projects)]).toEqual([['vp_1', homeProjectLink({ projectId: 'one' })]])
  })

  it('maps keyboard sequences without stealing ordinary typing', () => {
    expect(shellShortcut('g', false)).toBe('prefix')
    expect(shellShortcut('/', false)).toBe('search')
    for (const [key, action] of [['o', 'overview'], ['t', 'todo'], ['r', 'resources'], ['p', 'projects']] as const) {
      expect(shellShortcut(key, true)).toBe(action)
      expect(shellShortcut(key.toUpperCase(), true)).toBe(action)
      expect(shellShortcut(key, false)).toBeNull()
      expect(shellShortcut(key, true, true)).toBeNull()
    }
    expect(shellShortcut('/', false, true)).toBeNull()
    expect(shellShortcut('g', true, true)).toBeNull()
    expect(shellShortcut('x', true)).toBeNull()
  })
})
