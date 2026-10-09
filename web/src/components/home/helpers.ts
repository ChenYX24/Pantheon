import type { Key, Lang } from '../../i18n'
import type { HomeStage, HomeTodo, HomeTodoKind } from '../../protocol/home'
import { homeProjectLink, panelOpeningSession, type HomeSelection } from '../../routes'
import { agoParts } from '../panels/ago'

const TODO_ORDER: HomeTodoKind[] = ['question', 'awaiting_approval', 'blocked', 'awaiting_review', 'session_waiting', 'session_rollover']

export function todoLabelKey(kind: HomeTodoKind): Key {
  return `home.todo.${kind}`
}

export function sortTodos(todos: readonly HomeTodo[]): HomeTodo[] {
  const at = (value: string) => Date.parse(value) || 0
  return [...todos].sort((a, b) => TODO_ORDER.indexOf(a.kind) - TODO_ORDER.indexOf(b.kind) || at(b.at) - at(a.at) || a.id.localeCompare(b.id))
}

export function stageProgress(stage: Pick<HomeStage, 'done' | 'total'>): { done: number; total: number; percent: number } {
  const total = Number.isFinite(stage.total) ? Math.max(0, Math.floor(stage.total)) : 0
  const done = Number.isFinite(stage.done) ? Math.max(0, Math.min(total, Math.floor(stage.done))) : 0
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 }
}

export function relativeTime(at: string, now: number, lang: Lang): string {
  const when = Date.parse(at)
  if (!Number.isFinite(when) || when <= 0 || !Number.isFinite(now)) return ''
  const { value, unit } = agoParts(when / 1000, now / 1000)
  return new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' }).format(value, unit)
}

export type { HomeSelection } from '../../routes'
export const projectLink = homeProjectLink

export function selectionFromSearch(search: string): HomeSelection | null {
  const query = new URLSearchParams(search)
  const projectId = query.get('project') ?? ''
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(projectId)) return null
  const taskId = query.get('task') ?? ''
  const reportFile = query.get('report') ?? ''
  return {
    projectId,
    ...(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(taskId) ? { taskId } : {}),
    ...(reportFile ? { reportFile } : {}),
  }
}

export function todoLink(todo: HomeTodo): string {
  if (todo.kind === 'session_waiting' && todo.link.sessionId) return panelOpeningSession(todo.link.sessionId)
  return projectLink({
    projectId: todo.link.projectId || todo.projectId,
    taskId: todo.link.taskId,
    reportFile: todo.link.reportFile,
  })
}
