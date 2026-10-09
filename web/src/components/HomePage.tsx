import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArrowLeft, Bell, ClipboardList, LogOut, RefreshCw, Search } from 'lucide-react'
import { t, useLang } from '../i18n'
import { homeApi, type HomeTodo } from '../protocol/home'
import { HOME_PATH, PANEL_PATH, homeSelection, legacyHomeRedirect, routeFor, type HomeTab } from '../routes'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'
import { ToastStack } from './ToastStack'
import { applyTheme, loadTheme, type ThemeChoice } from './theme'
import { safeText } from './text'
import { HomeCard, HomeTime } from './home/HomeCard'
import { HomeNotifications } from './home/HomeNotifications'
import { HomeProjectPage } from './home/HomeProjectPage'
import { HomeTable } from './home/HomeTable'
import { filterProjects, filterTasks, HOME_VIEWS, sortProjects, viewFromSearch, viewToSearch, type HomeViewState } from './home/board'
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
  const selection = route.kind === 'home' && route.projectId ? homeSelection(route.projectId, address.search) : null
  const view = viewFromSearch(address.search)
  const projectId = selection?.projectId
  const [all, needTasks] = useMemo(() => {
    const state = viewFromSearch(address.search)
    return [state.all, !projectId && ((state.view === 'table' && state.table === 'tasks') || !!state.q)] as const
  }, [address.search, projectId])
  const load = useCallback((signal: AbortSignal) => homeApi.index(all, signal), [all])
  const loadTasks = useCallback(async (signal: AbortSignal) => needTasks ? (await homeApi.tasks(all, signal)).tasks : [], [all, needTasks])
  const index = useHomeResource(load)
  const tasks = useHomeResource(loadTasks)
  const settings = useHomeResource(homeApi.fields)
  const data = index.data?.available ? index.data : null
  const changed = async () => { await index.refresh(); await tasks.refresh(); await settings.refresh() }
  const mutation = useHomeMutation(changed)

  useEffect(() => { document.title = `${projectId || t('home.title')} · Pantheon` }, [lang, projectId])
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

  const go = (path: string, replace = false) => {
    const url = new URL(path, location.origin)
    if (replace) history.replaceState(null, '', url.pathname + url.search)
    else history.pushState(null, '', url.pathname + url.search)
    setAddress({ pathname: url.pathname, search: url.search })
  }
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
  const setView = (next: HomeViewState) => go(address.pathname + viewToSearch(next, address.search), true)
  const setProjectQuery = (patch: { tab?: HomeTab; thread?: string }) => {
    const query = new URLSearchParams(address.search)
    for (const [key, value] of Object.entries(patch)) if (value) query.set(key, value)
    go(`${address.pathname}?${query}`)
  }
  const previous = new URLSearchParams(address.search).get('from')
  const back = `${HOME_PATH}${previous ? `?${previous}` : ''}`
  const matchingTasks = filterTasks(tasks.data ?? [], view)
  const projects = sortProjects(filterProjects(data?.projects ?? [], view, view.q ? matchingTasks : []), view.sort)
  const todos = sortTodos(data?.todos ?? []).filter((todo) => `${todo.projectId} ${todo.title} ${todo.detail}`.toLocaleLowerCase().includes(view.q.trim().toLocaleLowerCase()))
  const error = index.error || settings.error || (needTasks ? tasks.error : '')

  return <div className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-ink [overflow-wrap:anywhere]" data-testid="home-page">
    <header className="vp-blur vp-safe-pad-top z-10 shrink-0 border-b border-hairline">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2">
        {selection ? <a href={back} onClick={navigate} className="vp-control" title={t('home.back')}><ArrowLeft size={17} /><span className="text-vp-sm">{t('home.back')}</span></a> : <span className="text-vp-md font-semibold">{t('home.brand')}</span>}
        {!selection && <div className="vp-segmented" role="tablist" aria-label={t('home.views')}>{HOME_VIEWS.map((value) => <button type="button" key={value} className="vp-tab px-3 text-vp-sm" role="tab" aria-selected={view.view === value} onClick={() => setView({ ...view, view: value })}>{t(`home.view.${value}`)}</button>)}</div>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button type="button" className="vp-control" onClick={() => setNotifications(true)} title={t('home.notifications')}><Bell size={16} /></button>
          <button type="button" className="vp-control" onClick={() => void changed()} disabled={index.loading} title={t('home.refresh')}><RefreshCw size={16} className={index.loading ? 'animate-spin' : ''} /></button>
          <LanguageSwitch testid="home" />
          <ThemeToggle theme={theme} onChange={setTheme} />
          <a href={PANEL_PATH} className="vp-control text-vp-sm">{t('home.panel')}</a>
          <button type="button" className="vp-control" onClick={onSignOut} title={t('home.signOut')}><LogOut size={16} /></button>
        </div>
        {!selection && <label className="flex w-full min-w-0 items-center gap-2"><Search size={16} className="shrink-0 text-ink-2" /><input className="home-input" type="search" value={view.q} onChange={(event) => setView({ ...view, q: event.target.value })} placeholder={t('home.search')} aria-label={t('home.search')} /></label>}
      </div>
    </header>
    {selection ? <HomeProjectPage key={selection.projectId} selection={selection} settings={settings.data} state={view} onState={setView} onChanged={changed} onNavigate={navigate} onTab={(tab) => setProjectQuery({ tab })} onThread={(thread) => setProjectQuery({ thread, tab: 'chat' })} /> : <main className="vp-safe-bottom min-h-0 min-w-0 flex-1 overflow-y-auto p-3 [--vp-safe-pad:2rem]">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-vp-xs text-ink-2">{data && <span>{t('home.generated', { time: '' })}<HomeTime at={data.generatedAt} /></span>}<label className="flex items-center gap-2"><input type="checkbox" checked={view.all} onChange={(event) => setView({ ...view, all: event.target.checked })} />{t('home.allProjects')}</label></div>
        {error && <p role="alert" className="rounded-vp border border-hairline bg-surface p-3">{safeText(error)}</p>}
        {!index.data && index.loading && <p role="status">{t('home.loading')}</p>}
        {index.data && !index.data.available && <section className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="font-semibold">{t('home.unavailable')}</h2><p className="mt-2 text-ink-2">{safeText(index.data.reason)}</p></section>}
        {data && <>
          {view.view === 'cards' && <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <aside className="min-w-0 md:col-start-2 md:row-start-1"><details open className="rounded-vp-lg border border-hairline bg-surface p-3"><summary className="cursor-pointer text-vp-md font-semibold">{t('home.todos', { count: todos.length })}</summary><div className="mt-3"><HomeTodos todos={todos} onNavigate={navigate} /></div></details></aside>
            <section className="@container min-w-0 md:col-start-1 md:row-start-1" aria-label={t('home.projects')}>
              {!projects.length && <p className="rounded-vp border border-hairline bg-surface p-4 text-ink-2">{t(data.projects.length ? 'home.noMatches' : 'home.emptyProjects')}</p>}
              <div className="grid min-w-0 gap-4 @2xl:grid-cols-2">{projects.map((project) => <HomeCard key={project.id} project={project} fields={settings.data?.fields} onNavigate={navigate} busy={mutation.busy} onPin={() => void mutation.run(() => homeApi.patchMeta(project.id, { rev: project.metaRev, pinned: !project.meta.pinned }))} />)}</div>
            </section>
          </div>}
          {view.view === 'table' && <HomeTable projects={data.projects} tasks={tasks.data ?? []} todos={data.todos} settings={settings.data} state={view} onState={setView} onChanged={changed} onNavigate={navigate} />}
          {view.view === 'todo' && <section className="rounded-vp-lg border border-hairline bg-surface p-4"><h1 className="mb-4 flex items-center gap-2 text-vp-md font-semibold"><ClipboardList size={18} />{t('home.todos', { count: todos.length })}</h1><HomeTodos todos={todos} onNavigate={navigate} /></section>}
          {data.warnings.length > 0 && <details className="rounded-vp border border-hairline bg-surface p-3 text-vp-sm"><summary className="cursor-pointer">{t('home.warnings', { count: data.warnings.length })}</summary><ul className="mt-2 space-y-2 text-ink-2">{data.warnings.map((warning, i) => <li key={i}>{safeText(warning.projectId)} · {safeText(warning.file)}<p>{safeText(warning.message)}</p></li>)}</ul></details>}
        </>}
      </div>
    </main>}
    {notifications && <HomeNotifications onClose={() => setNotifications(false)} />}
    <ConfirmDialog />
    <ToastStack narrow={false} />
  </div>
}

function HomeTodos({ todos, onNavigate }: { todos: HomeTodo[]; onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  if (!todos.length) return <p className="text-vp-sm text-ink-2">{t('home.noTodos')}</p>
  const kinds = [...new Set(todos.map((todo) => todo.kind))]
  return <div className="space-y-4">{kinds.map((kind) => <section key={kind}><h2 className="mb-2 text-vp-sm font-semibold">{t(todoLabelKey(kind))}</h2><ul className="space-y-2">{todos.filter((todo) => todo.kind === kind).map((todo) => <li key={todo.id} className="min-w-0 border-t border-hairline pt-2">
    <a href={todoLink(todo)} onClick={onNavigate} className="block rounded-vp px-2 py-1.5 hover:bg-surface-2"><p className="text-vp-xs text-ink-2">{safeText(todo.projectId)}</p><p className="mt-1 text-vp-base font-medium">{safeText(todo.title)}</p>{todo.detail && <p className="mt-1 text-vp-sm text-ink-2">{safeText(todo.detail)}</p>}<p className="mt-1 text-vp-xs text-ink-3"><HomeTime at={todo.at} /></p></a>
  </li>)}</ul></section>)}</div>
}
