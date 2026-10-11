import { RolloverActions } from './RolloverActions'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Bell, ClipboardList, LogOut, RefreshCw, Search } from 'lucide-react'
import { t, useLang } from '../i18n'
import { homeApi, type HomeTodo } from '../protocol/home'
import { HOME_PATH, homeSelection, legacyHomeRedirect, routeFor, type HomeTab } from '../routes'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'
import { ToastStack } from './ToastStack'
import { applyTheme, loadTheme, type ThemeChoice } from './theme'
import { safeText } from './text'
import { HomeCard, HomeTime } from './home/HomeCard'
import { HomeNotifications } from './home/HomeNotifications'
import { HomeExecutionBanner } from './home/HomeExecution'
import { AppShell } from './shell/AppShell'
import { PageHeader } from './shell/PageHeader'
import { Badge } from './shell/StatusPill'
import { navigationProjects } from './shell/model'
import { HomeProjectPage } from './home/HomeProjectPage'
import { HomeResourcesPage } from './home/HomeResourcesPage'
import { HomeTable } from './home/HomeTable'
import { filterProjects, filterTasks, HOME_VIEWS, viewFromSearch, viewToSearch, type HomeViewState } from './home/board'
import { sortTodos, todoLabelKey, todoLink } from './home/helpers'
import { useHomeResource } from './home/useHomeResource'
import { useHomeMutation } from './home/useHomeMutation'
import './home/home.css'

function currentAddress() {
  const redirect = legacyHomeRedirect(location.pathname, location.search)
  const url = new URL(redirect ?? location.href, location.origin)
  return { pathname: url.pathname, search: url.search }
}

export function HomePage({ onSignOut }: { onSignOut: () => void }) {
  const lang = useLang()
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme)
  const [address, setAddress] = useState(currentAddress)
  const [notifications, setNotifications] = useState(false)
  const route = routeFor(address.pathname)
  const resourcesRoute = route.kind === 'home' && route.resources
  const selection = route.kind === 'home' && route.projectId ? homeSelection(route.projectId, address.search) : null
  const view = viewFromSearch(address.search)
  const projectId = selection?.projectId
  const [all, needTasks] = useMemo(() => {
    const state = viewFromSearch(address.search)
    return [!!resourcesRoute || state.all, !resourcesRoute && !projectId && ((state.view === 'table' && state.table === 'tasks') || !!state.q)] as const
  }, [address.search, projectId, resourcesRoute])
  const load = useCallback((signal: AbortSignal) => homeApi.index(all, signal), [all])
  const loadTasks = useCallback(async (signal: AbortSignal) => needTasks ? (await homeApi.tasks(all, signal)).tasks : [], [all, needTasks])
  const index = useHomeResource(load)
  const tasks = useHomeResource(loadTasks)
  const settings = useHomeResource(homeApi.fields)
  const execution = useHomeResource(homeApi.execution)
  const executionStatus = execution.error ? null : execution.data
  const data = index.data?.available ? index.data : null
  const changed = async () => { await index.refresh(); await tasks.refresh(); await settings.refresh(); await execution.refresh() }
  const mutation = useHomeMutation(changed)

  useEffect(() => { document.title = `${projectId || t(resourcesRoute ? 'home.res.title' : 'home.title')} · Pantheon` }, [lang, projectId, resourcesRoute])
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => {
    const update = () => {
      const next = currentAddress()
      if (next.pathname !== location.pathname || next.search !== location.search) history.replaceState(null, '', next.pathname + next.search)
      setAddress(next)
    }
    update()
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const go = useCallback((path: string, replace = false) => {
    const url = new URL(path, location.origin)
    if (replace) history.replaceState(null, '', url.pathname + url.search)
    else history.pushState(null, '', url.pathname + url.search)
    setAddress({ pathname: url.pathname, search: url.search })
  }, [])
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const url = new URL(event.currentTarget.href)
    const next = routeFor(url.pathname)
    if (url.origin !== location.origin || next.kind !== 'home') return
    event.preventDefault()
    if (next.projectId) {
      const from = projectId ? new URLSearchParams(address.search).get('from') : address.search.slice(1)
      if (from) url.searchParams.set('from', from)
    }
    go(url.pathname + url.search)
  }
  const setView = (next: HomeViewState) => go(address.pathname + viewToSearch(next, address.search))
  const setProjectQuery = (patch: { tab?: HomeTab; thread?: string }) => {
    const query = new URLSearchParams(address.search)
    for (const [key, value] of Object.entries(patch)) if (value) query.set(key, value)
    go(`${address.pathname}?${query}`)
  }
  const previous = new URLSearchParams(address.search).get('from')
  const matchingTasks = filterTasks(tasks.data ?? [], view)
  const projects = navigationProjects(filterProjects(data?.projects ?? [], view, view.q ? matchingTasks : []), data?.todos ?? [])
  const todos = sortTodos(data?.todos ?? []).filter((todo) => (!view.project || todo.projectId === view.project) && `${todo.projectId} ${todo.title} ${todo.detail}`.toLocaleLowerCase().includes(view.q.trim().toLocaleLowerCase()))
  const error = index.error || settings.error || (needTasks ? tasks.error : '')

  return <div className="pantheon-ui flex h-full min-w-0 flex-col overflow-hidden bg-bg text-ink [overflow-wrap:anywhere]" data-testid="home-page">
    <AppShell pathname={address.pathname} search={address.search} projects={data?.projects ?? []} todos={data?.todos ?? []} onNavigate={navigate} onGo={go} settings={<div className="shell-menu">
      <div className="flex flex-wrap items-center justify-between gap-3"><LanguageSwitch testid="home" /><ThemeToggle theme={theme} onChange={setTheme} /></div>
      <button type="button" className="vp-control" onClick={() => setNotifications(true)}><Bell size={16} />{t('home.notifications')}</button>
      <HomeExecutionBanner execution={executionStatus} error={execution.error} busy={mutation.busy} onEnabled={(enabled) => void mutation.run(() => homeApi.putExecution(enabled))} onRetry={() => void execution.refresh()} />
      <button type="button" className="vp-control" onClick={onSignOut}><LogOut size={16} />{t('home.signOut')}</button>
    </div>}>
    {resourcesRoute ? <HomeResourcesPage search={address.search} resourceId={route.kind === 'home' ? route.resourceId : undefined} projects={data?.projects ?? []} projectError={index.error} onNavigate={navigate} onGo={go} /> : selection ? <HomeProjectPage key={selection.projectId} selection={selection} settings={settings.data} state={view} onState={setView} onChanged={changed} onNavigate={navigate} onTab={(tab) => setProjectQuery({ tab })} onThread={(thread) => setProjectQuery({ thread })} returnSearch={previous ?? ''} execution={executionStatus} executionError={execution.error} /> : <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={t(view.view === 'todo' ? 'home.view.todo' : 'home.shell.overview')} subtitle={t('home.shell.subtitle')} actions={<button type="button" className="vp-control" onClick={() => void changed()} disabled={index.loading}><RefreshCw size={16} className={index.loading ? 'animate-spin' : ''} />{t('home.refresh')}</button>} />
      <div className="shell-page-body min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="@container mx-auto max-w-[1600px] space-y-4">
        <div className="flex min-w-0 items-center gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2"><Search size={16} className="shrink-0 text-ink-2" /><input data-home-search className="home-input" type="search" value={view.q} onChange={(event) => setView({ ...view, q: event.target.value })} placeholder={t('home.search')} aria-label={t('home.search')} /></label>
          {view.view !== 'todo' && <div className="vp-segmented" role="group" aria-label={t('home.views')}>{HOME_VIEWS.filter((value) => value !== 'todo').map((value) => <button type="button" key={value} className="vp-tab px-3" aria-pressed={view.view === value} data-active={view.view === value} onClick={() => setView({ ...view, view: value })}>{t(`home.view.${value}`)}</button>)}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-vp-xs text-ink-2">{data && <span>{t('home.generated', { time: '' })}<HomeTime at={data.generatedAt} /></span>}<label className="flex items-center gap-2"><input type="checkbox" checked={view.all} onChange={(event) => setView({ ...view, all: event.target.checked })} />{t('home.allProjects')}</label></div>
        {error && <p role="alert" className="rounded-vp border border-hairline bg-surface p-3">{safeText(error)}</p>}
        {!index.data && index.loading && <p role="status">{t('home.loading')}</p>}
        {index.data && !index.data.available && <section className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="font-semibold">{t('home.unavailable')}</h2><p className="mt-2 text-ink-2">{safeText(index.data.reason)}</p></section>}
        {data && <>
          {view.view === 'cards' && <>
            <div className="shell-summary" aria-label={t('home.shell.summary')}>
              {([
                { key: 'projects', count: data.projects.filter((project) => project.status === 'active').length, href: `${HOME_PATH}?activity=active` },
                { key: 'tasks', count: data.projects.reduce((sum, project) => sum + project.taskCounts.in_progress, 0), href: `${HOME_PATH}?view=table&status=in_progress` },
                { key: 'todos', count: data.todos.length, href: `${HOME_PATH}?view=todo` },
                { key: 'runs', count: data.projects.filter((project) => project.activeRun && ['running', 'reviewing'].includes(project.activeRun.state)).length, href: `${HOME_PATH}?activity=running` },
              ] as const).map(({ key, count, href }) => <a key={key} className="shell-stat" href={href} onClick={navigate}><span>{t(`home.shell.stat.${key}`)}</span><strong>{count}</strong></a>)}
            </div>
            <div className="home-overview-grid">
              <section className="min-w-0" aria-label={t('home.projects')}>
                {!projects.length && <p className="text-ink-2">{t(data.projects.length ? 'home.noMatches' : 'home.emptyProjects')}</p>}
                <div className="home-cards-grid">{projects.map(({ project, count }) => <HomeCard key={project.id} project={project} todoCount={count} fields={settings.data?.fields} returnSearch={address.search} onNavigate={navigate} busy={mutation.busy} onPin={() => void mutation.run(() => homeApi.patchMeta(project.id, { rev: project.metaRev, pinned: !project.meta.pinned }))} />)}</div>
              </section>
              <aside className="home-overview-todos min-w-0"><div className="shell-card"><h2 className="shell-section-title mb-4 flex items-center gap-2">{t('home.view.todo')}<Badge count={todos.length} /></h2><HomeTodos todos={todos} onNavigate={navigate} returnSearch={address.search} /></div></aside>
            </div>
          </>}
          {view.view === 'table' && <HomeTable projects={data.projects} tasks={tasks.data ?? []} todos={data.todos} settings={settings.data} state={view} onState={setView} onChanged={changed} onNavigate={navigate} returnSearch={address.search} execution={executionStatus} />}
          {view.view === 'todo' && <section className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="mb-4 flex items-center gap-2 text-vp-md font-semibold"><ClipboardList size={18} />{t('home.view.todo')}<Badge count={todos.length} /></h2><HomeTodos todos={todos} onNavigate={navigate} returnSearch={address.search} /></section>}
          {data.warnings.length > 0 && <details className="rounded-vp border border-hairline bg-surface p-3 text-vp-sm"><summary className="cursor-pointer">{t('home.warnings', { count: data.warnings.length })}</summary><ul className="mt-2 space-y-2 text-ink-2">{data.warnings.map((warning, i) => <li key={i}>{safeText(warning.projectId)} · {safeText(warning.file)}<p>{safeText(warning.message)}</p></li>)}</ul></details>}
        </>}
      </div></div>
    </main>}
    </AppShell>
    {notifications && <HomeNotifications onClose={() => setNotifications(false)} />}
    <ConfirmDialog />
    <ToastStack narrow={false} />
  </div>
}

function HomeTodos({ todos, onNavigate, returnSearch }: { todos: HomeTodo[]; onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void; returnSearch: string }) {
  if (!todos.length) return <p className="text-vp-sm text-ink-2">{t('home.noTodos')}</p>
  const kinds = [...new Set(todos.map((todo) => todo.kind))]
  return <div className="space-y-4">{kinds.map((kind) => <section key={kind}><h2 className="mb-2 flex items-center gap-2 text-vp-sm font-semibold">{t(todoLabelKey(kind))}<Badge count={todos.filter((todo) => todo.kind === kind).length} /></h2><ul className="space-y-2">{todos.filter((todo) => todo.kind === kind).map((todo) => <li key={todo.id} className="min-w-0 border-t border-hairline pt-2">
    <a href={todoLink(todo, returnSearch)} onClick={onNavigate} className="block rounded-vp px-2 py-1.5 hover:bg-surface-2"><p className="text-vp-xs text-ink-2">{safeText(todo.projectId)}</p><p className="mt-1 text-vp-base font-medium">{safeText(todo.title)}</p>{todo.detail && <p className="mt-1 line-clamp-2 text-vp-sm text-ink-2">{safeText(todo.detail)}</p>}<p className="mt-1 text-vp-xs text-ink-3"><HomeTime at={todo.at} /></p></a>
    {todo.kind === 'session_rollover' && todo.link.sessionId && <RolloverActions id={todo.link.sessionId} onlyResume reason="long" />}
  </li>)}</ul></section>)}</div>
}
