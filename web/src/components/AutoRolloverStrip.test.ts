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

  it('counts down locally with a cancel action', () => {
    setLang('en')
    const html = render({ state: 'countdown', pct: 72, endsAt: Date.now() + 28_000 })
    expect(html).toContain('Handing off… 28 s')
    expect(html).toContain('Cancel')
    expect(html).not.toContain('Hand off now')
  })

  it('reports handoff and failure without promising the old session survived', () => {
    setLang('en')
    expect(render({ state: 'handing_off', pct: 72 })).toContain('Saving the handoff')
    const failed = render({ state: 'failed', pct: 72 })
    expect(failed).toContain('Check the session rollover status')
    expect(failed).toContain('lucide-triangle-alert')
  })

  it('rounds up and holds zero while waiting for the next server state', () => {
    expect(rolloverSeconds(30_000, 2_001)).toBe(28)
    expect(rolloverSeconds(30_000, 30_001)).toBe(0)
  })
})
