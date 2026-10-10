import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import { HomeResourceCard, HomeResourceURL } from './HomeResourceCard'
import { HomeCheckHistory } from './HomeResourceDetail'
import { HomeResourceScope } from './HomeResourceEditor'
import { HomeSecretFields } from './HomeResourceSecrets'
import { HomeServerChip, HomeServerMetrics, HomeServerOverview } from './HomeResourceStatus'
import { HomeProjectResourceSettings, HomeResourceChoices } from './HomeProjectResources'
import { HomeSessions } from './HomeSessions'
import { HomeSuggestionAction } from './HomeSuggestionAction'
import { projectFixture } from './fixtures'
import { resourceDetailFixture, resourceFixture, serverFixture } from './resourceFixtures'
import { emptySecretDraft } from './resources'

const language = getLang()
afterEach(() => setLang(language))

describe('resource content', () => {
  it.each(['zh', 'en'] as const)('renders API cards and stored check details in %s without starting checks', (lang) => {
    setLang(lang)
    const onCheck = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeResourceCard, { resource: { ...resourceFixture, title: '<script>hello\u202E</script>' }, boardURL: '', busy: false, onCheck, onSecrets: vi.fn(), onNavigate: vi.fn() }))
    expect(html).toContain('/home/resources/api-main')
    expect(html).toContain('OPENAI_API_KEY')
    expect(html).toContain(t('home.res.configured'))
    expect(html).toContain(t('home.res.unconfigured'))
    expect(html).toContain(t('home.res.setSecrets'))
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('\u202E')
    expect(onCheck).not.toHaveBeenCalled()
    const history = renderToStaticMarkup(createElement(HomeCheckHistory, { checks: resourceDetailFixture.checks }))
    expect(history).toContain(t('home.res.modelCount', { count: 2 }))
    expect(history).toContain('model-a')
  })

  it('renders configured metadata beside empty password inputs with autocomplete off', () => {
    const html = renderToStaticMarkup(createElement(HomeSecretFields, { secrets: resourceFixture.secrets, draft: emptySecretDraft(resourceFixture.secrets), busy: false, onChange: vi.fn(), onRemove: vi.fn() }))
    expect(html.match(/type="password"/g)).toHaveLength(2)
    expect(html.match(/autoComplete="off"/g)).toHaveLength(2)
    expect(html.match(/value=""/g)).toHaveLength(2)
    expect(html).toContain(t('home.res.updated'))
    expect(html).toContain(t('home.res.removeSecret'))
    expect(html).not.toContain('type="text"')
  })

  it('shows the observation note only for current low usage, and never turns missing memory into zero', () => {
    const html = renderToStaticMarkup(createElement(HomeServerMetrics, { server: serverFixture }))
    expect(html).toContain('aria-valuenow="25"')
    expect(html).toContain(t('home.res.lowUsage'))
    expect(html).toContain(t('home.res.observationOnly'))
    for (const server of [{ ...serverFixture, state: 'stale' as const }, { ...serverFixture, gpus: [{ ...serverFixture.gpus[0], observation: 'usage_observed' as const }] }]) {
      expect(renderToStaticMarkup(createElement(HomeServerMetrics, { server }))).not.toContain(t('home.res.lowUsage'))
    }
    const missing = renderToStaticMarkup(createElement(HomeServerMetrics, { server: { ...serverFixture, gpus: [{ ...serverFixture.gpus[0], memoryUsedMib: null }] } }))
    expect(missing).not.toContain('role="progressbar"')
    expect(missing).toContain(t('home.res.unknown'))
  })

  it('carries state labels and glyphs independently of color', () => {
    for (const state of ['fresh', 'stale', 'disconnected', 'unknown', 'unsupported'] as const) {
      const html = renderToStaticMarkup(createElement(HomeServerChip, { state }))
      expect(html).toContain('<svg')
      expect(html).toContain(t(`home.res.state.${state}`))
    }
  })

  it('keeps unavailable snapshots distinct from a zero-resource summary and blocks unsafe links', () => {
    const html = renderToStaticMarkup(createElement(HomeServerOverview, { data: { servers: [], sshAliases: [], board: { available: false, collectedAt: '', staleAfterSeconds: 180, url: 'javascript:alert(1)' } } }))
    expect(html).toContain(t('home.res.boardUnavailable'))
    expect(html).not.toContain('href=')
    expect(html).not.toContain(t('home.res.freshGPUCount', { count: 0 }))
    expect(renderToStaticMarkup(createElement(HomeResourceURL, { url: 'javascript:alert(1)' }))).not.toContain('href=')
  })

  it('keeps unlisted project scopes visible and exposes the all-project selection', () => {
    const html = renderToStaticMarkup(createElement(HomeResourceScope, { value: ['unlisted'], projects: [{ id: 'pantheon' }], disabled: false, onChange: vi.fn() }))
    expect(html).toContain('unlisted')
    expect(html).toContain('pantheon')
    expect(html).toContain(t('home.res.allProjects'))
  })

  it('links project resource chips to details and exposes default editing', () => {
    const onSave = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeProjectResourceSettings, {
      data: { resources: [resourceFixture], defaultResources: ['api-main'] }, error: '', busy: false,
      onSave, onRetry: vi.fn(), onNavigate: vi.fn(),
    }))
    expect(html).toContain('/home/resources/api-main')
    expect(html).toContain('href="/home/resources"')
    expect(html).toContain(t('home.res.defaults'))
    expect(html).toContain(resourceFixture.title)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders session resource checkboxes from allowed defaults and retains explicit deselection', () => {
    const props = { resources: [resourceFixture, { ...resourceFixture, id: 'other', title: 'Other' }], disabled: false, onChange: vi.fn() }
    const html = renderToStaticMarkup(createElement(HomeResourceChoices, { ...props, value: ['api-main'] }))
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(renderToStaticMarkup(createElement(HomeResourceChoices, { ...props, value: [] }))).not.toContain('checked=""')
  })

  it('waits for the allowed-resource list before offering to create a session', () => {
    const onCreate = vi.fn()
    const html = renderToStaticMarkup(createElement(HomeSessions, { project: projectFixture, resources: null, resourceError: 'Unavailable', busy: false, onCreate, onRetry: vi.fn() }))
    expect(html).toContain('disabled=""')
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('home.retry'))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it.each(['zh', 'en'] as const)('renders resource suggestions as explicit action chips in %s', (lang) => {
    setLang(lang)
    const onApply = vi.fn()
    const suggestion = { type: 'use_resources' as const, resources: ['api-main', 'gpu\u202E'] }
    const html = renderToStaticMarkup(createElement(HomeSuggestionAction, { suggestion, applied: false, disabled: false, onApply }))
    expect(html).toContain(t('home.res.useSuggestion'))
    expect(html).toContain('api-main')
    expect(html).toContain('gpu�')
    expect(onApply).not.toHaveBeenCalled()
    const applied = renderToStaticMarkup(createElement(HomeSuggestionAction, { suggestion, applied: true, disabled: false, onApply }))
    expect(applied).toContain('disabled=""')
    expect(applied).toContain(t('home.applied'))
  })
})
