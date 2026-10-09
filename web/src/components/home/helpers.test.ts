import { afterEach, describe, expect, it } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import type { HomeTodo, HomeTodoKind } from '../../protocol/home'
import { projectLink, relativeTime, selectionFromSearch, sortTodos, stageProgress, todoLabelKey, todoLink } from './helpers'

const language = getLang()
afterEach(() => setLang(language))
const todo = (kind: HomeTodoKind, at = '2026-10-09T12:00:00Z', id: string = kind): HomeTodo => ({
  id, kind, at, projectId: 'pantheon', title: kind, detail: '',
  link: { projectId: 'pantheon', taskId: 'A2', reportFile: '', sessionId: 'vp_123' },
})

describe('home to-dos', () => {
  it('orders urgency before recency without mutating the index', () => {
    const input = [todo('session_rollover'), todo('awaiting_review'), todo('question'), todo('blocked'), todo('session_waiting'), todo('awaiting_approval')]
    const original = [...input]
    expect(sortTodos(input).map((v) => v.kind)).toEqual(['question', 'awaiting_approval', 'blocked', 'awaiting_review', 'session_waiting', 'session_rollover'])
    expect(input).toEqual(original)
    expect(sortTodos([todo('blocked', '', 'missing'), todo('blocked', '2026-10-08', 'old'), todo('blocked', '2026-10-09', 'new')]).map((v) => v.id)).toEqual(['new', 'old', 'missing'])
  })

  it('has a distinct translated label for each kind in both languages', () => {
    const kinds: HomeTodoKind[] = ['question', 'awaiting_approval', 'blocked', 'awaiting_review', 'session_waiting', 'session_rollover']
    for (const lang of ['en', 'zh'] as const) {
      setLang(lang)
      const labels = kinds.map((kind) => t(todoLabelKey(kind)))
      expect(new Set(labels).size).toBe(kinds.length)
      expect(labels.every((label) => label && !label.startsWith('home.'))).toBe(true)
      expect(labels.every((label) => /[\u4e00-\u9fff]/.test(label))).toBe(lang === 'zh')
    }
  })
})

describe('stage progress', () => {
  it('counts completed tasks, including an empty stage, without an overflowing bar', () => {
    expect(stageProgress({ done: 1, total: 6 })).toEqual({ done: 1, total: 6, percent: 17 })
    expect(stageProgress({ done: 0, total: 0 })).toEqual({ done: 0, total: 0, percent: 0 })
    expect(stageProgress({ done: 7, total: 6 })).toEqual({ done: 6, total: 6, percent: 100 })
    expect(stageProgress({ done: -1, total: 6 }).percent).toBe(0)
    expect(stageProgress({ done: NaN, total: Infinity })).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('report relative times', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  it('reads RFC3339 offsets and speaks the selected language', () => {
    expect(relativeTime('2026-10-09T19:58:00+08:00', now, 'en')).toBe('2 minutes ago')
    expect(relativeTime('2026-10-06T12:00:00Z', now, 'zh')).toBe('3天前')
    expect(relativeTime('2026-10-08T12:00:00Z', now, 'en')).toBe('yesterday')
  })
  it('does not invent an age for an invalid date or put future updates in the future', () => {
    expect(relativeTime('', now, 'en')).toBe('')
    expect(relativeTime('not a date', now, 'en')).toBe('')
    expect(relativeTime('2026-10-10T12:00:00Z', now, 'en')).toBe('now')
  })
})

describe('home links', () => {
  it('round-trips project, task and report selection and rejects invalid IDs', () => {
    const selected = { projectId: 'pantheon', taskId: 'A2', reportFile: '汇报 & review.md' }
    expect(selectionFromSearch(new URL(projectLink(selected), 'http://panel').search)).toEqual(selected)
    expect(selectionFromSearch('?project=pantheon')).toEqual({ projectId: 'pantheon' })
    expect(selectionFromSearch('?task=A2')).toBeNull()
    expect(selectionFromSearch('?project=../x')).toBeNull()
    expect(selectionFromSearch('?project=pantheon&task=../../x')).toEqual({ projectId: 'pantheon' })
  })
  it('opens waiting sessions in the terminal and rollover tasks in their project', () => {
    expect(todoLink(todo('session_waiting'))).toBe('/?session=vp_123')
    expect(todoLink(todo('session_rollover'))).toBe('/home?project=pantheon&task=A2')
    const question = todo('question')
    question.link = { projectId: 'pantheon', taskId: '', reportFile: 'question.md', sessionId: '' }
    expect(todoLink(question)).toBe('/home?project=pantheon&report=question.md')
  })
})
