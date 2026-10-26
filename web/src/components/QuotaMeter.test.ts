import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { QuotaMeter } from './QuotaMeter'
import { currentLimits, windowLabel } from './quota'
import { isOutdated, ownBundle } from './bundle'
import type { AgentQuota } from '../protocol/wire'
import { getLang, setLang } from '../i18n'

const language = getLang()
afterEach(() => setLang(language))

const far = Math.floor(Date.now() / 1000) + 3600
const claude: AgentQuota = {
  limits: [{ minutes: 300, used: 12, resetsAt: far }, { minutes: 10080, used: 7, resetsAt: far + 86400 }],
  plan: '',
  source: 'claude-statusline',
  at: '2026-10-26T15:42:00Z',
}

it('names the windows the way both agents do', () => {
  expect([300, 10080, 60, 1440, 45].map(windowLabel)).toEqual(['5h', '7d', '1h', '1d', '45m'])
})

// A window past its reset has started over, and its last figure is no longer
// true: 96% of a five-hour window that is now empty.
it('leaves out a window whose reset has passed', () => {
  const q = { ...claude, limits: [{ minutes: 300, used: 96, resetsAt: 100 }, { minutes: 10080, used: 7, resetsAt: 0 }] }
  expect(currentLimits(q, 200)).toEqual([{ minutes: 10080, used: 7, resetsAt: 0 }])
  expect(currentLimits(undefined, 200)).toEqual([])
})

it.each(['zh', 'en'] as const)('shows both windows as text, with the account in its label, in %s', (lang) => {
  setLang(lang)
  const html = renderToStaticMarkup(createElement(QuotaMeter, { quota: claude }))
  expect(html).toContain('5h 12% · 7d 7%')
  expect(html).toContain(lang === 'en' ? 'Claude subscription limits' : 'Claude 订阅额度')
  expect(html).toContain('text-ink-2')
})

it('repeats a high figure in colour, never only in colour', () => {
  const html = renderToStaticMarkup(createElement(QuotaMeter, { quota: { ...claude, limits: [{ minutes: 300, used: 96, resetsAt: far }] } }))
  expect(html).toContain('5h 96%')
  expect(html).toContain('text-state-crashed')
  const codex = renderToStaticMarkup(createElement(QuotaMeter, { quota: { ...claude, source: 'codex-rollout', plan: 'pro', limits: [{ minutes: 10080, used: 82, resetsAt: far }] } }))
  expect(codex).toContain('7d 82%')
  expect(codex).toContain('Codex pro')
  expect(codex).toContain('text-state-waiting')
})

it('draws nothing without a current window', () => {
  expect(renderToStaticMarkup(createElement(QuotaMeter, {}))).toBe('')
  expect(renderToStaticMarkup(createElement(QuotaMeter, { quota: { ...claude, limits: [] } }))).toBe('')
})

function doc(...srcs: string[]): Pick<Document, 'querySelectorAll'> {
  return { querySelectorAll: () => srcs.map((src) => ({ getAttribute: () => src })) } as unknown as Pick<Document, 'querySelectorAll'>
}

it('reads the build this page booted from out of its script tag', () => {
  expect(ownBundle(doc('/assets/react-DfO9JKZv.js', '/assets/index-CPtGAEua.js'))).toBe('index-CPtGAEua.js')
  expect(ownBundle(doc('/dev/assets/index-CPtGAEua.js'))).toBe('index-CPtGAEua.js')
  expect(ownBundle(doc('/src/main.tsx'))).toBe('')
})

it('calls a page outdated only when both builds are known and differ', () => {
  expect(isOutdated('index-B.js', 'index-A.js')).toBe(true)
  expect(isOutdated('index-A.js', 'index-A.js')).toBe(false)
  expect(isOutdated('', 'index-A.js')).toBe(false)
  expect(isOutdated('index-B.js', '')).toBe(false)
})
