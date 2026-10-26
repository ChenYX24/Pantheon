import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutoRollover } from '../protocol/wire'
import { getLang, setLang } from '../i18n'
import { announceHandoff, handoffInputFocused, selectedHandoff } from './rolloverHandoff'
import { clearToasts, toastsSnapshot } from './toasts'
import { ToastStack } from './ToastStack'
import { HandoffButton } from './HandoffButton'

const language = getLang()
afterEach(() => { clearToasts(); setLang(language); vi.useRealTimers(); vi.unstubAllGlobals() })
const handed: AutoRollover = { state: 'handed_off', pct: 72, newSessionId: 'new', endsAt: 999_000 }

it('switches only the selected old session, once per pairing across changing snapshots and selections', () => {
  const seen = new Set<string>()
  expect(selectedHandoff(seen, { old: { ...handed, state: 'verifying' } }, 'old')).toBeNull()
  expect(selectedHandoff(seen, { old: handed }, 'old')).toEqual({ oldId: 'old', newId: 'new' })
  expect(selectedHandoff(seen, { old: { ...handed } }, 'new')).toBeNull()
  expect(selectedHandoff(seen, { old: { ...handed } }, 'old')).toBeNull()
  expect(selectedHandoff(seen, {}, 'old')).toBeNull()
  expect(selectedHandoff(seen, { old: { ...handed, newSessionId: 'next' } }, 'old')).toEqual({ oldId: 'old', newId: 'next' })
})

it('does not interrupt someone viewing a different session, including a later return to the old one', () => {
  const seen = new Set<string>()
  expect(selectedHandoff(seen, { old: handed }, 'unrelated')).toBeNull()
  expect(selectedHandoff(seen, { old: handed }, 'old')).toBeNull()
})

it.each([false, true])('announces confirmation without stealing a focused input (%s), and sends exact toast requests', async (focused) => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockImplementation(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  const select = vi.fn()
  announceHandoff({ oldId: 'old/id', newId: 'new' }, select, focused)
  expect(select.mock.calls).toEqual(focused ? [] : [['new']])
  expect(fetch).not.toHaveBeenCalled()
  const toast = toastsSnapshot()[0]
  await vi.advanceTimersByTimeAsync(60_000)
  expect(toastsSnapshot()).toHaveLength(1)
  expect(toast.actions?.map((a) => a.key)).toEqual(['autoRollover.back', 'autoRollover.releaseToast'])
  await toast.actions![0].run()
  expect(select).toHaveBeenLastCalledWith('old/id')
  await toast.actions![1].run()
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ['/dev/api/sessions/old%2Fid/rollover/auto', 'POST', '{"action":"keep"}'],
    ['/dev/api/sessions/old%2Fid/rollover/auto', 'POST', '{"action":"release"}'],
  ])
  for (const lang of ['zh', 'en'] as const) {
    setLang(lang)
    const html = renderToStaticMarkup(createElement(ToastStack, { narrow: true }))
    expect(html).toContain(lang === 'zh' ? '回到旧会话' : 'Back to old session')
    expect(html).toContain(lang === 'zh' ? '释放' : 'Release')
    expect(html).toContain('flex-wrap')
    expect(html).not.toContain('autoFocus')
  }
})

it('holds the move for a compose box but not for the focused terminal', () => {
  const classes = (...names: string[]) => ({ contains: (name: string) => names.includes(name) })
  expect(handoffInputFocused({ tagName: 'TEXTAREA', classList: classes() })).toBe(true)
  expect(handoffInputFocused({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  expect(handoffInputFocused({ tagName: 'INPUT', type: 'text' })).toBe(true)
  expect(handoffInputFocused({ tagName: 'TEXTAREA', classList: classes('xterm-helper-textarea') })).toBe(false)
  expect(handoffInputFocused({ tagName: 'BUTTON' })).toBe(false)
  expect(handoffInputFocused(null)).toBe(false)
})

it.each(['verifying', 'handed_off', 'confirmed'] as const)('disables the Hand off button for a paired %s session', (state) => {
  const html = renderToStaticMarkup(createElement(HandoffButton, { sessionId: 'paired', status: { state, pct: 0, replaces: state === 'confirmed' ? 'old' : undefined } }))
  expect(html).toContain('disabled=""')
})
