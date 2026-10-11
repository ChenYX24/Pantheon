import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../../i18n'
import { HOME_PATH } from '../../routes'
import { projectFixture } from '../home/fixtures'
import { AppShell, ProjectStatus } from './AppShell'
import { PageHeader } from './PageHeader'
import { Badge, StatusPill } from './StatusPill'

const language = getLang()
afterEach(() => setLang(language))

describe('shell content', () => {
  it.each(['zh', 'en'] as const)('labels navigation and settings in %s without an old workspace entry', (lang) => {
    setLang(lang)
    const html = renderToStaticMarkup(createElement(AppShell, {
      pathname: HOME_PATH, search: '?view=todo', projects: [projectFixture], todos: [],
      onNavigate: vi.fn(), onGo: vi.fn(), settings: 'Preferences', children: createElement(PageHeader, { title: t('home.view.todo') }),
    }))
    expect(html).toContain('data-testid="app-shell"')
    expect(html).toContain(t('home.shell.overview'))
    expect(html).toContain(t('home.shell.settings'))
    expect(html).toContain('href="/home?view=todo"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('/home/p/pantheon')
    expect(html).not.toContain('href="/projects"')
    expect(html).not.toContain('Preferences')
    expect(html.match(/<h1\b/g)).toHaveLength(1)
  })

  it('hides zero count badges and preserves accessible labels for nonzero counts', () => {
    expect(renderToStaticMarkup(createElement(Badge, { count: 0 }))).toBe('')
    expect(renderToStaticMarkup(createElement(Badge, { count: 3, label: 'Three questions' }))).toContain('aria-label="Three questions"')
  })

  it('keeps status labels readable, and glyphs available in the collapsed rail', () => {
    const html = renderToStaticMarkup(createElement(ProjectStatus, { project: projectFixture, compact: true }))
    expect(html).toContain('aria-label=')
    expect(html).toContain('<svg')
    expect(html).toContain('data-state="waiting"')
    const pill = renderToStaticMarkup(createElement(StatusPill, { label: '<script>test</script>', color: 'red' }))
    expect(pill).toContain('&lt;script&gt;')
    expect(pill).not.toContain('<script>')
  })
})
