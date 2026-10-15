import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

import { getLang, setLang, t } from '../i18n'
import type { UpdateStatus } from '../protocol/wire'
import { UpdateSection } from './UpdateSection'

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: vi.fn(react.useState) }
})

const language = getLang()
afterEach(() => {
  setLang(language)
  vi.clearAllMocks()
})

const available: UpdateStatus = {
  current: 'v1.25.0-pantheon.1', platform: 'linux/amd64', autoCheck: true, checking: false,
  checkedAt: 1, version: 'v1.29.1', newer: true, asset: 'https://example/upstream.tar.gz',
}

function render(status: UpdateStatus | null): string {
  // Seed the polled status for server rendering; no effects, browser or live
  // endpoint are needed to check which controls the real component offers.
  vi.mocked(useState).mockImplementationOnce(() => [status, vi.fn()])
  return renderToStaticMarkup(createElement(UpdateSection))
}

it.each(['en', 'zh'] as const)('explains managed updates in %s without offering upstream actions', (lang) => {
  setLang(lang)
  const html = render({
    ...available, managed: true, byHand: 'sudo vibepanel service upgrade', elevate: true,
    job: { stage: 'restarting', version: 'v1.29.1', startedAt: 1, done: 1, total: 1, restarting: true },
  })
  expect(html).toContain(t('upd.managed'))
  expect(html).toContain(available.current)
  for (const id of ['update-check', 'update-auto-check', 'update-release', 'update-apply', 'update-elevate', 'update-job']) {
    expect(html).not.toContain(`data-testid="${id}"`)
  }
  expect(html).not.toContain('v1.29.1')
  expect(html).not.toContain('service upgrade')
})

it('waits for the build policy before showing update controls', () => {
  const html = render(null)
  expect(html).toContain('data-testid="update-section"')
  expect(html).not.toContain('<button')
  expect(html).not.toContain('<input')
})

it('keeps check, auto-check and install controls for an enabled channel', () => {
  const html = render(available)
  for (const id of ['update-check', 'update-auto-check', 'update-release', 'update-apply']) {
    expect(html).toContain(`data-testid="${id}"`)
  }
  expect(html).not.toContain(t('upd.managed'))
})
