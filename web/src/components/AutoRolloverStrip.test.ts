import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { AutoRolloverStrip } from './AutoRolloverStrip'
import { rolloverSeconds } from './rollover'
import { getLang, setLang } from '../i18n'
import type { AutoRollover } from '../protocol/wire'

const language = getLang()
afterEach(() => setLang(language))
const render = (status?: AutoRollover) => renderToStaticMarkup(createElement(AutoRolloverStrip, { sessionId: 'fixture', status }))

describe('automatic rollover strip', () => {
  it('is absent after cancellation and when ok', () => {
    expect(render()).toBe('')
    expect(render({ state: 'ok', pct: 70 })).toBe('')
    expect(render({ state: 'cancelled', pct: 70 })).toBe('')
  })

  it.each([['zh', '这一轮结束后', '现在交接', '稍后', '本会话不自动'], ['en', 'After this turn finishes', 'Hand off now', 'Later', 'Never for this session']] as const)('explains the boundary and actions in %s', (lang, boundary, now, later, never) => {
    setLang(lang)
    const html = render({ state: 'due', pct: 72 })
    for (const text of [boundary, now, later, never, '72%', 'lucide-clock']) expect(html).toContain(text)
    expect(html).toContain('flex-wrap')
    expect(html).not.toContain('autoFocus')
  })

  it('says a requested handoff was requested and offers only Cancel', () => {
    setLang('en')
    const html = render({ state: 'due', pct: 8, reason: 'now' })
    expect(html).toContain('Handoff requested')
    expect(html).toContain('Cancel')
    // Later and Never are about the automatic trigger, which this is not.
    for (const gone of ['Later', 'Never for this session', 'Hand off now', '8%']) expect(html).not.toContain(gone)
    expect(render({ state: 'due', pct: 72, reason: 'threshold' })).toContain('Never for this session')
  })

  it.each(['turn', 'draft', 'background', 'input', 'quiet'] as const)('says why a due session is waiting: %s', (waiting) => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang)
      const html = render({ state: 'due', pct: 8, reason: 'now', waiting })
      expect(html).toContain('data-testid="rollover-waiting"')
      expect(html).not.toContain('autoRollover.wait')
    }
  })

  it('says nothing about waiting at the boundary or after it', () => {
    setLang('en')
    expect(render({ state: 'due', pct: 8, reason: 'now' })).not.toContain('rollover-waiting')
    expect(render({ state: 'countdown', pct: 8, endsAt: Date.now() + 9000, waiting: 'turn' })).not.toContain('rollover-waiting')
  })

  it('counts down locally with a cancel action', () => {
    setLang('en')
    const html = render({ state: 'countdown', pct: 72, endsAt: Date.now() + 28_000 })
    expect(html).toContain('Handing off… 28 s')
    expect(html).toContain('Cancel')
    expect(html).not.toContain('Hand off now')
  })

  it('reports handoff and the failed confirmation reason', () => {
    setLang('en')
    expect(render({ state: 'handing_off', pct: 72 })).toContain('Saving the handoff')
    const failed = render({ state: 'failed', pct: 72, reason: 'ack timed out' })
    expect(failed).toContain('Handoff not confirmed: ack timed out')
    expect(failed).toContain('lucide-triangle-alert')
  })

  it('rounds up and holds zero while waiting for the next server state', () => {
    expect(rolloverSeconds(30_000, 2_001)).toBe(28)
    expect(rolloverSeconds(30_000, 30_001)).toBe(0)
  })
})

it.each(['zh', 'en'] as const)('renders both sides of confirmation and release in %s', (lang) => {
  setLang(lang)
  const show = (status: AutoRollover) => renderToStaticMarkup(createElement(AutoRolloverStrip, { sessionId: 'old', status, summary: 'Run the next check', onSelect: () => {} }))
  const verifying = show({ state: 'verifying', pct: 72, newSessionId: 'new' })
  expect(verifying).toContain('↻')
  expect(verifying).toContain(lang === 'zh' ? '新会话正在确认交接' : 'The new session is confirming')
  expect(verifying).toContain(lang === 'zh' ? '打开新会话' : 'Open fresh session')
  const handed = show({ state: 'handed_off', pct: 72, newSessionId: 'new', endsAt: Date.now() + 61_000 })
  expect(handed).toContain('1:01')
  expect(handed).toContain(lang === 'zh' ? '保留旧会话' : 'Keep old session')
  expect(handed).toContain(lang === 'zh' ? '立即释放' : 'Release now')
  const receiving = show({ state: 'verifying', pct: 0, replaces: 'old' })
  expect(receiving).toContain(lang === 'zh' ? '正在接手' : 'Taking over')
  expect(receiving).not.toContain('<button')
  const confirmed = show({ state: 'confirmed', pct: 0, replaces: 'old' })
  expect(confirmed).toContain('Run the next check')
  expect(confirmed).not.toContain('<button')
  const failed = show({ state: 'failed', pct: 72, newSessionId: 'new', reason: 'no ack' })
  expect(failed).toContain('no ack')
  expect(failed).toContain(lang === 'zh' ? '打开新会话' : 'Open fresh session')
})
