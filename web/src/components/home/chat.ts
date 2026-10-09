import { appStorage } from '../../basePath'
import type { HomeExecutor, HomeMessage, HomeModels, HomeSendResult } from '../../protocol/home'

export function modelDefault(models: HomeModels, remembered: HomeExecutor | null): HomeExecutor | null {
  if (remembered?.model.trim() && models.harnesses.some((item) => item.harness === remembered.harness && item.installed)) return remembered
  const installed = models.harnesses.find((item) => item.installed && (item.default || item.models.length))
  return installed ? { harness: installed.harness, model: installed.default || installed.models[0] } : null
}

export function loadHomeModel(projectId: string): HomeExecutor | null {
  try {
    const value = JSON.parse(appStorage.getItem(`home.model.${projectId}`) ?? 'null')
    return value && ['claude', 'codex'].includes(value.harness) && typeof value.model === 'string' && value.model.trim()
      ? { harness: value.harness, model: value.model } : null
  } catch { return null }
}

export function saveHomeModel(projectId: string, executor: HomeExecutor) {
  try { appStorage.setItem(`home.model.${projectId}`, JSON.stringify(executor)) } catch { /* Storage may be disabled in a private tab. */ }
}

export interface ChatState {
  thread: string
  messages: HomeMessage[]
  sending: boolean
  run: { thread: string; id: string } | null
  error: string
}
export type ChatEvent =
  | { type: 'select'; thread: string }
  | { type: 'send'; text: string; at: string }
  | { type: 'accepted'; thread: string; result: HomeSendResult }
  | { type: 'snapshot'; thread: string; messages: HomeMessage[] }
  | { type: 'error'; error: string }
  | { type: 'retry'; thread: string; id: string }
  | { type: 'delete'; thread: string }

export function initialChat(thread: string): ChatState {
  return { thread, messages: [], sending: false, run: null, error: '' }
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'select': return { ...state, thread: event.thread, messages: [], error: '' }
    case 'send': return { ...state, sending: true, error: '', messages: [...state.messages,
      { id: 'optimistic-user', role: 'user', text: event.text, at: event.at, status: 'done' },
      { id: 'optimistic-assistant', role: 'assistant', text: '', at: event.at, status: 'pending' },
    ] }
    case 'accepted': return {
      ...state, sending: false, error: '', run: event.result.assistant.status === 'pending' ? { thread: event.thread, id: event.result.assistant.id } : null,
      messages: event.thread === state.thread ? [...state.messages.filter((entry) => !entry.id.startsWith('optimistic-') && entry.id !== event.result.user.id && entry.id !== event.result.assistant.id), event.result.user, event.result.assistant] : state.messages,
    }
    case 'snapshot': {
      const pending = event.messages.find((entry) => entry.role === 'assistant' && entry.status === 'pending')
      const olderRead = !pending && state.run?.thread === event.thread && !event.messages.some((entry) => entry.id === state.run?.id)
      return {
        ...state,
        messages: event.thread === state.thread && !state.sending && !olderRead ? event.messages : state.messages,
        run: pending ? { thread: event.thread, id: pending.id }
          : state.run?.thread === event.thread && event.messages.some((entry) => entry.id === state.run?.id) ? null : state.run,
      }
    }
    case 'error': return { ...state, sending: false, error: event.error, messages: state.messages.filter((entry) => !entry.id.startsWith('optimistic-')) }
    case 'retry': return { ...state, error: '', run: { thread: event.thread, id: event.id }, messages: state.messages.map((entry) => entry.id === event.id ? { ...entry, status: 'pending', error: undefined } : entry) }
    case 'delete': return { ...state, run: state.run?.thread === event.thread ? null : state.run, messages: state.thread === event.thread ? [] : state.messages }
  }
}

export function chatPollInterval(state: ChatState): number { return state.run || state.sending ? 2000 : 10000 }
export function chatPending(state: ChatState): boolean { return state.sending || !!state.run || state.messages.some((entry) => entry.status === 'pending') }
export function enterSends(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}
