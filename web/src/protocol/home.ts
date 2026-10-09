import { appFetch } from '../basePath'
import { t } from '../i18n'
import type { SessionState } from './wire'

// File-backed tasks have their own states and revisions; the workflow board
// is a different API even when both views name the same checkout.
export const HOME_TASK_STATUSES = [
  'planned', 'in_progress', 'awaiting_review', 'awaiting_approval', 'blocked', 'done', 'cancelled',
] as const
export type HomeTaskStatus = typeof HOME_TASK_STATUSES[number]
export type HomeTodoKind = 'question' | 'awaiting_approval' | 'blocked' | 'awaiting_review' | 'session_waiting' | 'session_rollover'
export type HomeSessionStatus = 'ok' | 'rollover_due'

export interface HomeStage { name: string; done: number; total: number }
export interface HomeSession { id: string; name: string; state: SessionState; agent: string; stateChangedAt: string }
export interface HomeReportSummary {
  file: string
  title: string
  summary: string
  at: string
  kind: 'report' | 'question'
  needsUser: boolean
}
export interface HomeReport extends HomeReportSummary { task: string; body: string }
export interface HomeProject {
  id: string
  aliases: string[]
  portfolio: string
  category: string
  status: string
  path: string
  pathExists: boolean
  panelProjectId: string | null
  goal: string
  activeDocs: { title: string; href: string }[]
  lastVerified: string
  blockers: string[]
  taskCounts: Record<HomeTaskStatus | 'total', number>
  stages: HomeStage[]
  latestReport: HomeReportSummary | null
  sessions: HomeSession[]
  usage: { known: false }
  updatedAt: string
}
export interface HomeTodoLink { projectId: string; taskId: string; reportFile: string; sessionId: string }
export interface HomeTodo {
  id: string
  kind: HomeTodoKind
  projectId: string
  title: string
  detail: string
  at: string
  link: HomeTodoLink
}
export interface HomeWarning { projectId: string; file: string; message: string }
export type HomeIndex = { available: false; reason: string } | {
  available: true
  generatedAt: string
  projects: HomeProject[]
  todos: HomeTodo[]
  warnings: HomeWarning[]
}
export interface HomeTask {
  id: string
  title: string
  status: HomeTaskStatus
  stage: string
  primary: string
  secondary: string
  dependsOn: string[]
  session: string
  blockedReason: string
  sessionStatus: HomeSessionStatus
  updated: string
  handoffs: number
  body: string
  rev: string
  file: string
}
export interface HomeProjectDetail { project: HomeProject; tasks: HomeTask[]; reports: HomeReport[]; todos: HomeTodo[] }
export interface HomeCreateTask {
  title: string
  stage?: string
  status?: HomeTaskStatus
  primary?: string
  secondary?: string
  dependsOn?: string[]
  body?: string
  id?: string
}
export interface HomePatchTask {
  rev: string
  status?: HomeTaskStatus
  blockedReason?: string
  sessionStatus?: HomeSessionStatus
  session?: string
}
export interface HomeCreateSession { profileId?: string; name?: string }
export interface HomeCreatedSession { sessionId: string; panelProjectId: string }
export interface HomeExecutor { harness: 'claude' | 'codex'; model: string }
export interface HomeExecutorOption extends HomeExecutor { installed: boolean; source: string }
export type HomeSuggestion =
  | { type: 'create_task'; task: HomeCreateTask }
  | { type: 'set_status'; taskId: string; status: HomeTaskStatus }
  | { type: 'create_session'; name: string }
export interface HomeMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  executor?: HomeExecutor
  suggestions?: HomeSuggestion[]
  suggestedModel?: HomeExecutor & { reason: string }
}
export interface HomeDiscussion { messages: HomeMessage[] }
export interface HomeNotifications {
  mode: 'off' | 'dry_run' | 'send'
  items: {
    todoId: string
    projectId: string
    channel: string
    // §7 also records baseline rows; they carry no delivery to retry.
    status: 'dry_run' | 'sent' | 'failed' | 'pending' | 'baseline'
    text: string
    attempts: number
    createdAt: string
    sentAt: string
  }[]
}

export class HomeAPIError extends Error {
  readonly status: number
  readonly rev?: string

  constructor(status: number, message: string, rev?: string) {
    super(message)
    this.name = 'HomeAPIError'
    this.status = status
    this.rev = rev
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await appFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const reason = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`
    throw new HomeAPIError(response.status, reason === 'stale' ? t('home.conflict') : reason, data?.rev)
  }
  return data as T
}

const projectPath = (id: string) => `/api/home/projects/${encodeURIComponent(id)}`

export const homeApi = {
  index: (all = false, signal?: AbortSignal) => request<HomeIndex>(`/api/home${all ? '?all=1' : ''}`, 'GET', undefined, signal),
  project: (id: string, signal?: AbortSignal) => request<HomeProjectDetail>(projectPath(id), 'GET', undefined, signal),
  createTask: (id: string, task: HomeCreateTask) => request<HomeTask>(`${projectPath(id)}/tasks`, 'POST', task),
  patchTask: (id: string, taskId: string, patch: HomePatchTask) => request<HomeTask>(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}`, 'PATCH', patch),
  createSession: (id: string, session: HomeCreateSession) => request<HomeCreatedSession>(`${projectPath(id)}/sessions`, 'POST', session),
  discussion: (id: string, signal?: AbortSignal) => request<HomeDiscussion>(`${projectPath(id)}/discussion`, 'GET', undefined, signal),
  // The POST response is unspecified. Read the persisted messages through GET
  // after sending instead of coupling the UI to an invented response shape.
  sendMessage: (id: string, message: string, executor: HomeExecutor) => request<unknown>(`${projectPath(id)}/discussion`, 'POST', { message, executor }),
  notifications: (signal?: AbortSignal) => request<HomeNotifications>('/api/home/notifications', 'GET', undefined, signal),
  executors: (signal?: AbortSignal) => request<HomeExecutorOption[]>('/api/workflow/executors', 'GET', undefined, signal),
}
