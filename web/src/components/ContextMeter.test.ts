import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextMeter } from './ContextMeter'
import { getLang, setLang } from '../i18n'
import type { ContextUsage } from '../protocol/wire'

const language = getLang()
afterEach(() => setLang(language))
const usage: ContextUsage = { used: 620_000, window: 1_000_000, model: 'claude-opus-5-5', source: 'claude-transcript', at: '2026-10-16T00:00:00Z' }
const render = (value?: ContextUsage, compact = false) => renderToStaticMarkup(createElement(ContextMeter, { usage: value, compact }))

describe('context usage', () => {
  it('uses the policy due state even below the default 70% colour band', () => {
    setLang('en')
    const html = renderToStaticMarkup(createElement(ContextMeter, { usage: { ...usage, used: 30_000 }, rollover: { state: 'due', pct: 3 } }))
    expect(html).toContain('text-state-waiting')
    expect(html).toContain('lucide-clock')
    expect(html).toContain('Handoff pending after this turn')
  })
  it('shows nothing until a usage event is known', () => {
    expect(render()).toBe('')
  })

  it.each([['en', 'Context'], ['zh', '上下文']] as const)('labels the reading in %s', (lang, label) => {
    setLang(lang)
    const html = render(usage)
    expect(html).toContain('62%')
    expect(html).toContain(`title="${label}: 620k / 1M"`)
    expect(html).toContain(`aria-label="${label}: 620k / 1M"`)
    expect(html).toContain('width:62%')
  })

  it('shows tokens without a percentage or bar when the window is unknown', () => {
    const html = render({ ...usage, window: 0 })
    expect(html).toContain('620k')
    expect(html).not.toContain('%')
    expect(html).not.toContain('width:')
  })

  it.each([
    [0, 'text-ink-2'], [69, 'text-ink-2'], [70, 'text-state-waiting'],
    [84, 'text-state-waiting'], [85, 'text-state-crashed'], [100, 'text-state-crashed'],
  ])('pairs the %i%% band with a number and bar', (percent, color) => {
    const html = render({ ...usage, used: percent * 10_000 }, true)
    expect(html).toContain(color)
    expect(html).toContain(`${percent}%`)
    expect(html).toContain(`width:${percent}%`)
  })

  it('bounds the bar while preserving an over-window reading', () => {
    const html = render({ ...usage, used: 1_200_000 })
    expect(html).toContain('120%')
    expect(html).toContain('width:100%')
    expect(html).toContain('1.2M / 1M')
  })

  it('keeps the label in the tooltip on compact rows', () => {
    setLang('en')
    const html = render(usage, true)
    expect(html).toContain('Context: 620k / 1M')
    expect(html).not.toContain('>Context<')
    expect(html).not.toContain('px-1.5')
  })
})
