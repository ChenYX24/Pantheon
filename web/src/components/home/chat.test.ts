import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeMessage, HomeModels, HomeSendResult } from '../../protocol/home'
import { chatPending, chatPollInterval, chatReducer, enterSends, initialChat, loadHomeModel, modelDefault, saveHomeModel } from './chat'

const user: HomeMessage = { id: 'u1', role: 'user', text: 'What next?', at: '2026-10-09T12:00:00Z', status: 'done' }
const assistant: HomeMessage = { id: 'a1', role: 'assistant', text: '', at: user.at, status: 'pending' }
const result: HomeSendResult = { user, assistant }
const accepted = () => chatReducer(chatReducer(initialChat('main'), { type: 'send', text: user.text, at: user.at }), { type: 'accepted', thread: 'main', result })

afterEach(() => vi.unstubAllGlobals())

describe('chat polling state', () => {
  it('shows optimistic bubbles immediately, then replaces them with persisted IDs', () => {
    const state = chatReducer(initialChat('main'), { type: 'send', text: user.text, at: user.at })
    expect(state.messages.map((entry) => [entry.role, entry.status])).toEqual([['user', 'done'], ['assistant', 'pending']])
    expect(chatPending(state)).toBe(true)
    expect(chatPollInterval(state)).toBe(2000)
    const next = chatReducer(state, { type: 'accepted', thread: 'main', result })
    expect(next.messages).toEqual([user, assistant])
    expect(next.run).toEqual({ thread: 'main', id: 'a1' })
    expect(next.sending).toBe(false)
  })
  it('polls every two seconds until done or failed and retries in place', () => {
    const state = accepted()
    for (const status of ['done', 'failed'] as const) {
      const next = chatReducer(state, { type: 'snapshot', thread: 'main', messages: [user, { ...assistant, status, error: status === 'failed' ? 'timeout' : undefined }] })
      expect(chatPending(next)).toBe(false)
      expect(chatPollInterval(next)).toBe(10000)
      const retried = chatReducer(next, { type: 'retry', thread: 'main', id: 'a1' })
      expect(retried.messages).toHaveLength(2)
      expect(retried.messages[1]).toMatchObject({ id: 'a1', status: 'pending', error: undefined })
      expect(chatPending(retried)).toBe(true)
    }
  })
  it('keeps a project run across thread switches and ignores unrelated snapshot content', () => {
    const switched = chatReducer(accepted(), { type: 'select', thread: 'other' })
    expect(switched.messages).toEqual([])
    expect(chatPending(switched)).toBe(true)
    const done = chatReducer(switched, { type: 'snapshot', thread: 'main', messages: [user, { ...assistant, status: 'done', text: 'Reply' }] })
    expect(done.thread).toBe('other')
    expect(done.messages).toEqual([])
    expect(chatPending(done)).toBe(false)
  })
  it('does not lose optimistic content or unlock on a GET that started before POST', () => {
    const sending = chatReducer(initialChat('main'), { type: 'send', text: user.text, at: user.at })
    expect(chatReducer(sending, { type: 'snapshot', thread: 'main', messages: [] }).messages).toEqual(sending.messages)
    const stale = chatReducer(accepted(), { type: 'snapshot', thread: 'main', messages: [] })
    expect(chatPending(stale)).toBe(true)
    expect(stale.messages).toEqual([user, assistant])
    const switched = chatReducer(sending, { type: 'select', thread: 'other' })
    const ack = chatReducer(switched, { type: 'accepted', thread: 'main', result })
    expect(ack.messages).toEqual([])
    expect(ack.run?.thread).toBe('main')
  })
  it('discovers runs in other threads, recovers POST errors and clears deleted runs', () => {
    const discovered = chatReducer(initialChat('main'), { type: 'snapshot', thread: 'other', messages: [assistant] })
    expect(chatPending(discovered)).toBe(true)
    expect(discovered.messages).toEqual([])
    expect(chatPending(chatReducer(discovered, { type: 'delete', thread: 'other' }))).toBe(false)
    const sending = chatReducer(initialChat('main'), { type: 'send', text: 'hello', at: user.at })
    const failed = chatReducer(sending, { type: 'error', error: 'offline' })
    expect(failed.messages).toEqual([])
    expect(failed.error).toBe('offline')
    expect(chatPending(failed)).toBe(false)
  })
  it('leaves composition Enter and Shift+Enter to the textarea', () => {
    const event = { key: 'Enter', shiftKey: false, isComposing: false }
    expect(enterSends(event)).toBe(true)
    expect(enterSends({ ...event, isComposing: true })).toBe(false)
    expect(enterSends({ ...event, keyCode: 229 })).toBe(false)
    expect(enterSends({ ...event, shiftKey: true })).toBe(false)
    expect(enterSends({ ...event, key: 'a' })).toBe(false)
  })
})

const models: HomeModels = { harnesses: [
  { harness: 'claude', installed: true, default: 'claude-opus-5-5', source: 'built-in default', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
  { harness: 'codex', installed: true, default: 'gpt-6-astra', source: 'Codex config', models: ['gpt-6-astra', 'gpt-6.1-sol'] },
] }

describe('model picker defaults', () => {
  it('preselects the server default and keeps remembered custom models on installed harnesses', () => {
    expect(modelDefault(models, null)).toEqual({ harness: 'claude', model: 'claude-opus-5-5' })
    expect(modelDefault(models, { harness: 'codex', model: 'custom' })).toEqual({ harness: 'codex', model: 'custom' })
    expect(modelDefault(models, { harness: 'codex', model: ' ' })).toEqual({ harness: 'claude', model: 'claude-opus-5-5' })
    const unavailable = { harnesses: models.harnesses.map((item) => ({ ...item, installed: item.harness === 'codex' })) }
    expect(modelDefault(unavailable, { harness: 'claude', model: 'custom' })?.harness).toBe('codex')
    expect(modelDefault({ harnesses: [] }, null)).toBeNull()
    expect(modelDefault({ harnesses: [{ ...models.harnesses[0], default: '' }] }, null)?.model).toBe('claude-opus-5-5')
  })
  it('scopes storage by project and base path, and tolerates denied or corrupt storage', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    saveHomeModel('pantheon', { harness: 'codex', model: 'custom' })
    expect(values.has('vibepanel:/dev:home.model.pantheon')).toBe(true)
    expect(loadHomeModel('pantheon')).toEqual({ harness: 'codex', model: 'custom' })
    expect(loadHomeModel('other')).toBeNull()
    values.set('vibepanel:/dev:home.model.pantheon', '{broken')
    expect(loadHomeModel('pantheon')).toBeNull()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(loadHomeModel('pantheon')).toBeNull()
    expect(() => saveHomeModel('pantheon', { harness: 'claude', model: 'test' })).not.toThrow()
  })
})
