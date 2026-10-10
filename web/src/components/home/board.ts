import type { HomeFieldOption, HomeProject, HomeTaskRow } from '../../protocol/home'

export const HOME_VIEWS = ['cards', 'table', 'todo'] as const
export const HOME_GROUPS = ['none', 'project', 'status', 'priority', 'stage', 'tags'] as const
export const HOME_SORTS = ['updated', 'priority', 'due', 'title'] as const
export interface HomeViewState {
  view: typeof HOME_VIEWS[number]
  table: 'tasks' | 'projects'
  q: string
  all: boolean
  project: string
  status: string[]
  priority: string[]
  tags: string[]
  owner: string
  group: typeof HOME_GROUPS[number]
  sort: typeof HOME_SORTS[number]
}

function choice<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback
}

export function viewFromSearch(search: string): HomeViewState {
  const q = new URLSearchParams(search)
  const list = (key: string) => [...new Set(q.getAll(key).filter(Boolean))]
  return {
    view: choice(q.get('view'), HOME_VIEWS, 'cards'), table: q.get('table') === 'projects' ? 'projects' : 'tasks',
    q: q.get('q') ?? '', all: q.get('all') === '1', project: q.get('filterProject') ?? '',
    status: list('status'), priority: list('priority'), tags: list('tags'), owner: q.get('owner') ?? '',
    group: choice(q.get('group'), HOME_GROUPS, 'none'), sort: choice(q.get('sort'), HOME_SORTS, 'updated'),
  }
}

export function viewToSearch(state: HomeViewState, search = ''): string {
  const q = new URLSearchParams(search)
  const defaults = viewFromSearch('')
  for (const key of ['view', 'table', 'q', 'owner', 'group', 'sort'] as const) {
    if (state[key] === defaults[key]) q.delete(key)
    else q.set(key, state[key])
  }
  if (state.all) q.set('all', '1'); else q.delete('all')
  if (state.project) q.set('filterProject', state.project); else q.delete('filterProject')
  for (const key of ['status', 'priority', 'tags'] as const) {
    q.delete(key)
    for (const value of [...new Set(state[key])]) if (value) q.append(key, value)
  }
  return q.size ? `?${q}` : ''
}

const includes = (text: string, query: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
const selected = (values: string[], value: string) => !values.length || values.includes(value)
const overlaps = (values: string[], row: string[]) => !values.length || values.some((value) => row.includes(value))
const priority = (value: string) => /^P[0-3]$/.test(value) ? Number(value[1]) : 4
const timestamp = (value: string) => Date.parse(value) || 0
const textOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export function filterTasks(tasks: readonly HomeTaskRow[], state: HomeViewState): HomeTaskRow[] {
  return tasks.filter((row) => (!state.project || row.projectId === state.project)
    && selected(state.status, row.status) && selected(state.priority, row.priority) && overlaps(state.tags, row.tags)
    && includes(row.owner, state.owner)
    && includes([row.projectId, row.id, row.title, row.stage, row.owner, row.primary, ...row.tags].join(' '), state.q))
}

export function sortTasks(tasks: readonly HomeTaskRow[], sort: HomeViewState['sort']): HomeTaskRow[] {
  return [...tasks].sort((a, b) => {
    const order = sort === 'title' ? textOrder(a.title, b.title)
      : sort === 'priority' ? priority(a.priority) - priority(b.priority)
        : sort === 'due' ? textOrder(a.due || '9999-99-99', b.due || '9999-99-99')
          : timestamp(b.updated) - timestamp(a.updated)
    return order || textOrder(a.projectId, b.projectId) || textOrder(a.id, b.id)
  })
}

export function filterProjects(projects: readonly HomeProject[], state: HomeViewState, matchingTasks: readonly HomeTaskRow[] = []): HomeProject[] {
  const matches = new Set(matchingTasks.map((row) => row.projectId))
  return projects.filter((row) => (!state.project || row.id === state.project)
    && selected(state.priority, row.meta.priority) && overlaps(state.tags, row.meta.labels) && includes(row.meta.owner, state.owner)
    && (includes([row.id, ...row.aliases, row.goal, row.meta.phase, ...row.meta.labels].join(' '), state.q) || matches.has(row.id)))
}

export function sortProjects(projects: readonly HomeProject[], sort: HomeViewState['sort']): HomeProject[] {
  return [...projects].sort((a, b) => Number(b.meta.pinned) - Number(a.meta.pinned)
    || (sort === 'title' ? textOrder(a.id, b.id) : sort === 'priority' ? priority(a.meta.priority) - priority(b.meta.priority) : timestamp(b.updatedAt) - timestamp(a.updatedAt))
    || textOrder(a.id, b.id))
}

function groups<T>(rows: readonly T[], keys: (row: T) => string[]): { value: string; rows: T[] }[] {
  const result = new Map<string, T[]>()
  for (const row of rows) for (const value of new Set(keys(row))) {
    const items = result.get(value) ?? []
    items.push(row)
    result.set(value, items)
  }
  return [...result].map(([value, rows]) => ({ value, rows }))
}

export function groupTasks(rows: readonly HomeTaskRow[], group: HomeViewState['group']) {
  return groups(rows, (row) => group === 'none' ? [''] : group === 'project' ? [row.projectId]
    : group === 'tags' ? row.tags.length ? row.tags : [''] : [row[group]])
}

export function groupProjects(rows: readonly HomeProject[], group: HomeViewState['group']) {
  return groups(rows, (row) => group === 'none' ? [''] : group === 'project' ? [row.id]
    : group === 'tags' ? row.meta.labels.length ? row.meta.labels : ['']
      : group === 'stage' ? [row.meta.phase] : group === 'status' ? [row.status] : [row.meta.priority])
}

// Reuse palette tokens that already follow both explicit and system themes.
const COLORS = {
  gray: 'var(--vp-ink-2)', blue: 'var(--vp-term-blue)', green: 'var(--vp-term-green)',
  orange: 'var(--vp-term-yellow)', red: 'var(--vp-term-red)', purple: 'var(--vp-term-magenta)',
  pink: 'var(--vp-term-bright-magenta)', teal: 'var(--vp-term-cyan)', yellow: 'var(--vp-term-bright-yellow)',
}

export function optionColor(color: string): string {
  return Object.hasOwn(COLORS, color) ? COLORS[color as keyof typeof COLORS] : COLORS.gray
}

export function optionFor(value: string, options: readonly HomeFieldOption[] = []): HomeFieldOption {
  return options.find((option) => option.value === value) ?? { value, color: 'gray' }
}
