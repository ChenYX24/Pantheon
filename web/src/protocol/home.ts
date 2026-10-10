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
export interface HomeReport extends HomeReportSummary { task: string; body: string; rev: string; replies: { at: string; text: string }[] }
export interface HomeProjectMeta { labels: string[]; priority: string; owner: string; phase: string; pinned: boolean }
export const HOME_FIELD_COLORS = ['gray', 'blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow'] as const
export type HomeFieldColor = typeof HOME_FIELD_COLORS[number]
export interface HomeFieldOption { value: string; label?: string; color: HomeFieldColor }
export interface HomeField { options: HomeFieldOption[] }
export interface HomeFields {
  task: Record<'status' | 'priority' | 'tags', HomeField>
  project: Record<'labels' | 'priority' | 'phase', HomeField>
}
export interface HomeFieldSettings { fields: HomeFields; rev: string }
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
  meta: HomeProjectMeta
  metaRev: string
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
  priority: string
  tags: string[]
  owner: string
  due: string
}
export type HomeTaskRow = HomeTask & { projectId: string }
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
  title?: string
  stage?: string
  priority?: string
  tags?: string[]
  owner?: string
  due?: string
  primary?: string
  secondary?: string
  dependsOn?: string[]
}
export type HomePatchMeta = Partial<HomeProjectMeta> & { rev: string }
export interface HomeCreateSession { profileId?: string; name?: string }
export interface HomeCreatedSession { sessionId: string; panelProjectId: string }
export interface HomeExecutor { harness: 'claude' | 'codex'; model: string }
export interface HomeExecutorOption extends HomeExecutor { installed: boolean; source: string }
export interface HomeModels { harnesses: { harness: HomeExecutor['harness']; installed: boolean; default: string; source: string; models: string[] }[] }
export interface HomeThread { id: string; title: string; updatedAt: string; messageCount: number }
export type HomeSuggestion =
  | { type: 'create_task'; task: HomeCreateTask }
  | { type: 'set_status'; taskId: string; status: HomeTaskStatus }
  | { type: 'create_session'; name: string }
  | { type: 'set_fields'; taskId: string; fields: Omit<HomePatchTask, 'rev'> }
  | { type: 'set_project'; fields: Partial<HomeProjectMeta> }
  | { type: 'reply_report'; file: string; text: string }
export interface HomeMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  status: 'pending' | 'done' | 'failed'
  error?: string
  executor?: HomeExecutor
  suggestions?: HomeSuggestion[]
  suggestedModel?: HomeExecutor & { reason: string }
}
export interface HomeDiscussion { messages: HomeMessage[] }
export interface HomeSendResult { user: HomeMessage; assistant: HomeMessage }
export type HomeNotifyMode = 'off' | 'dry_run' | 'send'
export interface HomeNotifySettings {
  mode: HomeNotifyMode
  flagMode: HomeNotifyMode
  webhookConfigured: boolean
  signed: boolean
  publicUrl: string
}
export interface HomePatchNotify { mode?: HomeNotifyMode; webhookUrl?: string; secret?: string; publicUrl?: string }
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
  const data = response.status === 204 ? null : await response.json().catch(() => {
    if (response.ok) throw new Error(t('home.invalidResponse'))
    return null
  })
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
  discussion: (id: string, thread = 'main', signal?: AbortSignal) => request<HomeDiscussion>(`${projectPath(id)}/discussion?${new URLSearchParams({ thread })}`, 'GET', undefined, signal),
  sendMessage: (id: string, message: string, executor: HomeExecutor, thread = 'main') => request<HomeSendResult>(`${projectPath(id)}/discussion`, 'POST', { message, executor, thread }),
  retryMessage: (id: string, messageId: string) => request<unknown>(`${projectPath(id)}/discussion/${encodeURIComponent(messageId)}/retry`, 'POST'),
  models: (signal?: AbortSignal) => request<HomeModels>('/api/home/models', 'GET', undefined, signal),
  threads: (id: string, signal?: AbortSignal) => request<{ threads: HomeThread[] }>(`${projectPath(id)}/threads`, 'GET', undefined, signal),
  createThread: (id: string, title?: string) => request<HomeThread>(`${projectPath(id)}/threads`, 'POST', title === undefined ? {} : { title }),
  renameThread: (id: string, threadId: string, title: string) => request<unknown>(`${projectPath(id)}/threads/${encodeURIComponent(threadId)}`, 'PATCH', { title }),
  deleteThread: (id: string, threadId: string) => request<unknown>(`${projectPath(id)}/threads/${encodeURIComponent(threadId)}`, 'DELETE'),
  fields: (signal?: AbortSignal) => request<HomeFieldSettings>('/api/home/fields', 'GET', undefined, signal),
  putFields: (settings: HomeFieldSettings) => request<unknown>('/api/home/fields', 'PUT', settings),
  tasks: (all = false, signal?: AbortSignal) => request<{ tasks: HomeTaskRow[]; fields: HomeFields }>(`/api/home/tasks${all ? '?all=1' : ''}`, 'GET', undefined, signal),
  patchMeta: (id: string, patch: HomePatchMeta) => request<unknown>(`${projectPath(id)}/meta`, 'PATCH', patch),
  replyReport: (id: string, file: string, text: string, rev?: string) => request<unknown>(`${projectPath(id)}/reports/${encodeURIComponent(file)}/reply`, 'POST', { text, ...(rev === undefined ? {} : { rev }) }),
  notifySettings: (signal?: AbortSignal) => request<HomeNotifySettings>('/api/home/notify-settings', 'GET', undefined, signal),
  putNotifySettings: (settings: HomePatchNotify) => request<unknown>('/api/home/notify-settings', 'PUT', settings),
  testNotification: () => request<{ ok: boolean; error?: string }>('/api/home/notify-settings/test', 'POST'),
  notifications: (signal?: AbortSignal) => request<HomeNotifications>('/api/home/notifications', 'GET', undefined, signal),
  executors: (signal?: AbortSignal) => request<HomeExecutorOption[]>('/api/workflow/executors', 'GET', undefined, signal),
}
