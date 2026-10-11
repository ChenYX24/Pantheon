import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { AlertTriangle, Boxes, Circle, ClipboardList, Folder, House, LoaderCircle, OctagonX, PanelLeftClose, PanelLeftOpen, Search, Settings, Terminal } from 'lucide-react'
import { appStorage } from '../../basePath'
import { t } from '../../i18n'
import type { HomeProject, HomeTodo } from '../../protocol/home'
import { homeProjectLink, routeFor } from '../../routes'
import { HomeDialog } from '../home/HomeDialog'
import { safeText } from '../text'
import { activeNavigation, navigationProjects, projectActivity, shellLinks, shellShortcut } from './model'
import { ShellSettings } from './ShellSettings'
import { Badge, StatusPill } from './StatusPill'
import './shell.css'

const icons = { overview: House, todo: ClipboardList, resources: Boxes, terminal: Terminal }
const states = { running: { color: 'blue', icon: LoaderCircle }, waiting: { color: 'orange', icon: AlertTriangle }, blocked: { color: 'red', icon: OctagonX }, idle: { color: 'gray', icon: Circle } } as const

export function ProjectStatus({ project, compact = false }: { project: HomeProject; compact?: boolean }) {
  const state = projectActivity(project)
  return <StatusPill label={t(`home.shell.state.${state}`)} state={state} compact={compact} {...states[state]} />
}

export function AppShell({ pathname, search, projects, todos, settings, onNavigate, onGo, children }: {
  pathname: string
  search: string
  projects: HomeProject[]
  todos: HomeTodo[]
  settings: ReactNode
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  onGo: (path: string) => void
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(() => { try { return appStorage.getItem('pantheon-sidebar-collapsed') === '1' } catch { return false } })
  const [picker, setPicker] = useState<{ anchor?: { top: number; left: number } } | null>(null)
  const [preferences, setPreferences] = useState(false)
  const [query, setQuery] = useState('')
  const projectSearch = useRef<HTMLInputElement>(null)
  const projectButton = useRef<HTMLButtonElement>(null)
  const openProjects = useCallback(() => {
    setPicker({ anchor: window.innerWidth >= 768 ? { top: Math.min(projectButton.current?.getBoundingClientRect().top ?? 64, window.innerHeight / 2), left: 64 } : undefined })
  }, [])
  const active = activeNavigation(pathname, search)
  const route = routeFor(pathname)
  const selected = route.kind === 'home' ? route.projectId : undefined
  const ordered = navigationProjects(projects, todos).filter(({ project }) => `${project.id} ${project.aliases.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const follow = (event: MouseEvent<HTMLAnchorElement>) => { onNavigate(event); if (event.defaultPrevented) { setPicker(null); setPreferences(false) } }

  useEffect(() => {
    let prefix = 0
    const focusProjects = () => {
      if (projectSearch.current?.getClientRects().length) projectSearch.current.focus()
      else openProjects()
    }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = !!target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('[aria-modal="true"]')) { prefix = 0; return }
      const action = shellShortcut(event.key, Date.now() - prefix < 1000, editing)
      prefix = action === 'prefix' ? Date.now() : 0
      if (!action) return
      event.preventDefault()
      if (action === 'projects') focusProjects()
      else if (action === 'search') {
        const input = [...document.querySelectorAll<HTMLInputElement>('[data-home-search]')].find((element) => element.getClientRects().length)
        if (input) input.focus(); else focusProjects()
      } else if (action !== 'prefix') onGo(shellLinks.find((item) => item.id === action)!.href)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onGo, openProjects])

  const projectList = (dialog = false) => <div className="shell-project-list">
    <label className="shell-search"><Search size={15} aria-hidden="true" /><input ref={dialog ? undefined : projectSearch} data-autofocus={dialog || undefined} type="search" className="home-input" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('home.shell.projectSearch')} placeholder={t('home.shell.projectSearch')} /></label>
    <nav aria-label={t('home.projects')} className="shell-project-items">{ordered.map(({ project, count }) => <a key={project.id} href={homeProjectLink({ projectId: project.id })} onClick={follow} className="vp-control shell-project-link" aria-current={selected === project.id ? 'page' : undefined} title={safeText([project.id, ...project.aliases].join(' · '))}>
      <ProjectStatus project={project} compact /><span className="truncate">{safeText(project.id)}</span><Badge count={count} label={t('home.todos', { count })} />
    </a>)}{!ordered.length && <p className="shell-meta px-2 text-ink-2">{t('home.noMatches')}</p>}</nav>
  </div>
  const link = (item: typeof shellLinks[number]) => {
    const Icon = icons[item.id]
    return <a key={item.id} href={item.href} onClick={follow} className="vp-control shell-nav-link" aria-current={active === item.id ? 'page' : undefined} title={t(item.label)}><Icon size={18} aria-hidden="true" /><span className="shell-nav-label">{t(item.label)}</span>{item.id === 'todo' && <Badge count={todos.length} />}</a>
  }

  return <ShellSettings.Provider value={settings}><div className="pantheon-ui app-shell" data-collapsed={collapsed} data-testid="app-shell">
    <aside className="shell-sidebar" aria-label={t('home.navigation')}>
      <div className="shell-brand"><a href={shellLinks[0].href} onClick={follow} className="vp-control" title={t('home.brand')}><House size={20} /><span className="shell-expanded">{t('home.brand')}</span></a><button type="button" className="vp-control shell-collapse" aria-label={t(collapsed ? 'home.shell.expand' : 'home.shell.collapse')} aria-expanded={!collapsed} onClick={() => { const next = !collapsed; setCollapsed(next); try { appStorage.setItem('pantheon-sidebar-collapsed', next ? '1' : '0') } catch { /* The rail still works when storage is unavailable. */ } }}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
      <nav className="shell-primary" aria-label={t('home.shell.primary')}>{shellLinks.map(link)}</nav>
      <div className="shell-expanded shell-project-section"><h2 className="shell-meta font-semibold">{t('home.projects')}</h2>{projectList()}</div>
      <button ref={projectButton} type="button" className="vp-control shell-project-trigger" title={t('home.projects')} aria-label={t('home.projects')} aria-haspopup="dialog" aria-expanded={!!picker} onClick={() => openProjects()}><Folder size={18} /></button>
      <button type="button" className="vp-control shell-settings-trigger" title={t('home.shell.settings')} aria-label={t('home.shell.settings')} aria-haspopup="dialog" aria-expanded={preferences} onClick={() => setPreferences(true)}><Settings size={18} /><span className="shell-nav-label">{t('home.shell.settings')}</span></button>
    </aside>
    <div className="shell-content">{children}</div>
    <nav className="shell-bottom" aria-label={t('home.shell.primary')}>{shellLinks.slice(0, 2).map(link)}<button type="button" className="vp-control shell-nav-link" aria-label={t('home.projects')} aria-current={active === 'projects' ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={!!picker} onClick={() => openProjects()}><Folder size={18} /><span>{t('home.projects')}</span></button>{shellLinks.slice(2).map(link)}</nav>
    {picker && <HomeDialog title={t('home.projects')} onClose={() => setPicker(null)} anchor={picker.anchor}>{projectList(true)}</HomeDialog>}
    {preferences && <HomeDialog title={t('home.shell.settings')} onClose={() => setPreferences(false)}>{settings}</HomeDialog>}
  </div></ShellSettings.Provider>
}
