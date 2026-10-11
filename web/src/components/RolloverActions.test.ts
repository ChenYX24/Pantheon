import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../i18n'
import { api } from '../protocol/api'
import { RolloverActions } from './RolloverActions'
import { canRollover } from './rollover'
import { HomeSessions } from './home/HomeSessions'
import { projectFixture } from './home/fixtures'

const language = getLang()
afterEach(() => { setLang(language); vi.unstubAllGlobals() })

it('offers only supported agents, including absolute launch commands', () => {
  expect(canRollover({ command: 'node', launchCommand: ['/bin/codex'] })).toBe(true)
  expect(canRollover({ command: 'claude', launchCommand: [] })).toBe(true)
  expect(canRollover({ command: 'bash', launchCommand: ['bash', 'codex'] })).toBe(false)
  expect(canRollover({ command: 'codex', launchCommand: ['vibepanel', 'home-worker', 'job'] })).toBe(false)
})

it.each(['zh', 'en'] as const)('renders both handoff actions and the long-session action in %s', (lang) => {
  setLang(lang)
  const html = renderToStaticMarkup(createElement(HomeSessions, { project: projectFixture, resources: null, resourceError: '', busy: false, onCreate: async () => true, onRetry: () => {} }))
  expect(html).toContain(t('rollover.end'))
  expect(html).toContain(t('rollover.resume'))
  const todo = renderToStaticMarkup(createElement(RolloverActions, { id: 's', onlyResume: true, reason: 'long' }))
  expect(todo).toContain(t('rollover.resume'))
  expect(todo).not.toContain(t('rollover.end'))
})

it('uses authenticated session routes under the base path with the contract body', async () => {
  const result = { handoff: '/handoff.md', newSessionId: 'next' }
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(result)))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  expect(await api.rolloverSession('session/id', true, 'long')).toEqual(result)
  await api.rolloverStatus('session/id')
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET', init.body])).toEqual([
    ['/dev/api/sessions/session%2Fid/rollover', 'POST', '{"reason":"long","resume":true}'],
    ['/dev/api/sessions/session%2Fid/rollover', 'GET', undefined],
  ])
})
