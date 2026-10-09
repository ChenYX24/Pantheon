import { describe, expect, it } from 'vitest'
import { HOME_FIELD_COLORS } from '../../protocol/home'
import { filterProjects, filterTasks, groupProjects, groupTasks, optionColor, optionFor, sortProjects, sortTasks, viewFromSearch, viewToSearch } from './board'
import { projectFixture, taskFixture } from './fixtures'

const rows = [
  taskFixture,
  { ...taskFixture, id: 'A3', title: 'Frontend', projectId: 'other', status: 'in_progress' as const, priority: 'P0', tags: ['frontend', 'review'], owner: 'sam', stage: 'B', due: '', updated: '2026-10-10T12:00:00Z' },
  { ...taskFixture, id: 'A4', title: 'Research', priority: 'custom', tags: [], owner: '', stage: '', due: '2026-10-11', updated: '' },
]

describe('URL view state', () => {
  it('round-trips filters, grouping, sorting and arbitrary Unicode values', () => {
    const state = { ...viewFromSearch(''), view: 'table' as const, table: 'projects' as const, q: '前端 & review', all: true, project: 'pantheon', status: ['planned', 'blocked'], priority: ['P0', 'P2'], tags: ['前端', 'a,b'], owner: 'cyx', group: 'tags' as const, sort: 'priority' as const }
    expect(viewFromSearch(viewToSearch(state))).toEqual(state)
    const search = viewToSearch(state, '?tab=tasks&thread=t-1&task=A2&from=view%3Dtodo')
    expect(new URLSearchParams(search).get('thread')).toBe('t-1')
    expect(new URLSearchParams(search).get('from')).toBe('view=todo')
    expect(new URLSearchParams(search).get('project')).toBeNull()
  })
  it('uses defaults for unknown choices, removes defaults and deduplicates multi-selects', () => {
    expect(viewFromSearch('?view=bad&table=bad&sort=bad&group=bad')).toEqual(viewFromSearch(''))
    expect(viewToSearch(viewFromSearch(''))).toBe('')
    expect(viewFromSearch('?tags=one&tags=one&tags=&tags=two').tags).toEqual(['one', 'two'])
    expect(viewToSearch(viewFromSearch(''), '?view=table&q=old&tags=x&tab=reports')).toBe('?tab=reports')
  })
})

describe('board transforms', () => {
  it('ORs values within one filter and ANDs different filters', () => {
    const state = { ...viewFromSearch(''), status: ['awaiting_approval', 'in_progress'], priority: ['P0', 'P1'], tags: ['review', 'unknown'] }
    expect(filterTasks(rows, state).map((row) => row.id)).toEqual(['A2', 'A3'])
    expect(filterTasks(rows, { ...state, project: 'pantheon', owner: 'CYX' }).map((row) => row.id)).toEqual(['A2'])
    expect(filterTasks(rows, { ...state, q: 'FRONTEND' }).map((row) => row.id)).toEqual(['A3'])
    expect(filterTasks(rows, { ...state, tags: ['removed-option'] })).toEqual([])
  })
  it('searches project text and matching task text', () => {
    expect(filterProjects([projectFixture], { ...viewFromSearch(''), q: 'PARTHENON' })).toHaveLength(1)
    expect(filterProjects([projectFixture], { ...viewFromSearch(''), q: 'Backend' }, [taskFixture])).toHaveLength(1)
    expect(filterProjects([projectFixture], { ...viewFromSearch(''), priority: ['P1'] })).toHaveLength(0)
    expect(filterProjects([projectFixture], { ...viewFromSearch(''), tags: ['product'], owner: 'CYX' })).toHaveLength(1)
  })
  it('sorts without mutation, keeps missing dates last and unknown priorities after P3', () => {
    const original = rows.map((row) => row.id)
    expect(sortTasks(rows, 'updated').map((row) => row.id)).toEqual(['A3', 'A2', 'A4'])
    expect(sortTasks(rows, 'priority').map((row) => row.id)).toEqual(['A3', 'A2', 'A4'])
    expect(sortTasks(rows, 'due').map((row) => row.id)).toEqual(['A4', 'A2', 'A3'])
    expect(sortTasks(rows, 'title').map((row) => row.id)).toEqual(['A2', 'A3', 'A4'])
    expect(rows.map((row) => row.id)).toEqual(original)
    const pinned = { ...projectFixture, id: 'pinned', updatedAt: '', meta: { ...projectFixture.meta, pinned: true } }
    expect(sortProjects([projectFixture, pinned], 'updated').map((row) => row.id)).toEqual(['pinned', 'pantheon'])
  })
  it('places multi-tag rows in each matching group once and retains the unset group', () => {
    const grouped = groupTasks([...rows, { ...taskFixture, id: 'A5', tags: ['review', 'review'] }], 'tags')
    expect(grouped.map((group) => [group.value, group.rows.length])).toEqual([['backend', 1], ['review', 3], ['frontend', 1], ['', 1]])
    expect(groupTasks(rows, 'project').map((group) => [group.value, group.rows.length])).toEqual([['pantheon', 2], ['other', 1]])
    expect(groupTasks(rows, 'status').map((group) => group.value)).toEqual(['awaiting_approval', 'in_progress'])
    expect(groupTasks(rows, 'stage').map((group) => group.value)).toEqual(['A', 'B', ''])
    expect(groupTasks(rows, 'none')[0].rows).toEqual(rows)
    expect(groupProjects([projectFixture], 'stage')[0].value).toBe('development')
    expect(groupProjects([projectFixture], 'tags')[0].value).toBe('product')
  })
})

describe('option colors', () => {
  it('maps only the contracted colors to theme tokens and preserves unknown values in gray', () => {
    for (const color of HOME_FIELD_COLORS) expect(optionColor(color)).toMatch(/^var\(--vp-/)
    expect(new Set(HOME_FIELD_COLORS.map(optionColor)).size).toBe(9)
    expect(optionColor('url(evil)')).toBe(optionColor('gray'))
    expect(optionColor('__proto__')).toBe(optionColor('gray'))
    expect(optionFor('removed', [{ value: 'current', label: 'Current', color: 'blue' }])).toEqual({ value: 'removed', color: 'gray' })
    expect(optionFor('current', [{ value: 'current', label: 'Renamed', color: 'blue' }]).label).toBe('Renamed')
  })
})
