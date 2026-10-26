import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { AutoRolloverFields } from './AutoRolloverSettings'
import { validAutoRolloverPolicy } from '../rollover'
import type { AutoRolloverPolicy } from '../../protocol/wire'
import { getLang, setLang } from '../../i18n'

const language = getLang()
afterEach(() => setLang(language))
const policy: AutoRolloverPolicy = { enabled: true, thresholdPct: 70, countdownSeconds: 30, keepOldMinutes: 10, idleInputSeconds: 120 }

it.each(['zh', 'en'] as const)('renders all controls and the retention limit in %s', (lang) => {
  setLang(lang)
  const html = renderToStaticMarkup(createElement(AutoRolloverFields, { policy, busy: false, onChange: () => {} }))
  expect(html.match(/type="number"/g)).toHaveLength(4)
  expect(html).toContain('type="checkbox"')
  expect(html).toContain(lang === 'en' ? 'Wait for the turn to finish' : '等本轮结束')
  expect(html).toContain(lang === 'en' ? 'Starts after confirmation' : '确认后计时')
  expect(html).not.toMatch(/\b(?:sm|md|lg):/)
})

it.each([
  ['thresholdPct', 30, 95], ['countdownSeconds', 5, 300],
  ['keepOldMinutes', 1, 120], ['idleInputSeconds', 10, 1800],
] as const)('validates %s before saving', (key, min, max) => {
  for (const n of [min, max]) expect(validAutoRolloverPolicy({ ...policy, [key]: n })).toBe(true)
  for (const n of [min - 1, max + 1, min + 0.5, NaN]) expect(validAutoRolloverPolicy({ ...policy, [key]: n })).toBe(false)
})
