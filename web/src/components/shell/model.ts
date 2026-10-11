import type { HomeProject, HomeTodo } from '../../protocol/home'
import { HOME_PATH, HOME_RESOURCES_PATH, PANEL_PATH, homeProjectLink, routeFor } from '../../routes'

export const shellLinks = [
  { id: 'overview', label: 'home.shell.overview', href: HOME_PATH },
  { id: 'todo', label: 'home.view.todo', href: `${HOME_PATH}?view=todo` },
  { id: 'resources', label: 'home.res.title', href: HOME_RESOURCES_PATH },
  { id: 'terminal', label: 'home.shell.terminal', href: PANEL_PATH },
] as const

export function activeNavigation(pathname: string, search: string) {
  const route = routeFor(pathname)
  if (route.kind !== 'home') return 'terminal'
  if (route.resources) return 'resources'
  if (route.projectId) return 'projects'
  return new URLSearchParams(search).get('view') === 'todo' ? 'todo' : 'overview'
}

export function projectActivity(project: HomeProject) {
  if (project.activeRun && ['running', 'reviewing'].includes(project.activeRun.state)) return 'running'
  if (project.sessions.some((session) => session.state === 'waiting')) return 'waiting'
  if (project.blockers.length || project.taskCounts.blocked) return 'blocked'
  return 'idle'
}

export function navigationProjects(projects: readonly HomeProject[], todos: readonly HomeTodo[]) {
  const counts = new Map<string, number>()
  for (const todo of todos) counts.set(todo.projectId, (counts.get(todo.projectId) ?? 0) + 1)
  const at = (value: string) => Date.parse(value) || 0
  const activity = (project: HomeProject) => Math.max(typeof project.activeRun?.startedAt === 'number' ? project.activeRun.startedAt * 1000 : at(project.activeRun?.startedAt ?? ''), at(project.updatedAt), at(project.latestReport?.at ?? ''), ...project.sessions.map((session) => at(session.stateChangedAt)))
  return [...projects].sort((a, b) => Number(b.meta.pinned) - Number(a.meta.pinned) || activity(b) - activity(a) || a.id.localeCompare(b.id))
    .map((project) => ({ project, count: counts.get(project.id) ?? 0, state: projectActivity(project) }))
}

export function currentStage(project: HomeProject) {
  const stages = project.stages.filter((stage) => stage.total > 0)
  return stages.find((stage) => stage.name === project.meta.phase) ?? stages.find((stage) => stage.done < stage.total) ?? stages.at(-1)
}

export function panelProjectLinks(projects: readonly HomeProject[]) {
  const links = new Map<string, string>()
  for (const project of projects) {
    if (!project.panelProjectId) continue
    // Two catalogue entries for one checkout are ambiguous; never guess which
    // project's tasks a terminal belongs to.
    if (projects.filter((other) => other.panelProjectId === project.panelProjectId).length === 1) {
      links.set(project.panelProjectId, homeProjectLink({ projectId: project.id }))
    }
  }
  return links
}

export function shellShortcut(key: string, prefix: boolean, editing = false) {
  if (editing) return null
  if (key === '/') return 'search'
  if (key.toLowerCase() === 'g') return 'prefix'
  if (!prefix) return null
  return ({ o: 'overview', t: 'todo', r: 'resources', p: 'projects' } as const)[key.toLowerCase() as 'o' | 't' | 'r' | 'p'] ?? null
}
