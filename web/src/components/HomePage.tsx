import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { ArrowLeft, ChevronDown, ClipboardList, LogOut, RefreshCw } from 'lucide-react'
import { t, useLang } from '../i18n'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { homeApi } from '../protocol/home'
import { HOME_PATH, PANEL_PATH } from '../routes'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'
import { applyTheme, loadTheme, type ThemeChoice } from './theme'
import { safeText } from './text'
import { HomeCard, HomeTime } from './home/HomeCard'
import { HomeProjectView } from './home/HomeProjectView'
import { selectionFromSearch, sortTodos, todoLabelKey, todoLink } from './home/helpers'
import { useHomeResource } from './home/useHomeResource'

export function HomePage({ onSignOut }: { onSignOut: () => void }) {
  const lang = useLang()
  const wide = useMediaQuery('(min-width: 768px)')
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme)
  const [all, setAll] = useState(false)
  const [todosOpen, setTodosOpen] = useState(true)
  const [selection, setSelection] = useState(() => selectionFromSearch(location.search))
  const load = useCallback((signal: AbortSignal) => homeApi.index(all, signal), [all])
  const { data, error, loading, refresh } = useHomeResource(load)

  useEffect(() => { document.title = `${t('home.title')} · Pantheon` }, [lang])
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => {
    const pop = () => setSelection(selectionFromSearch(location.search))
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const url = new URL(event.currentTarget.href)
    if (url.pathname !== HOME_PATH) return
    event.preventDefault()
    history.pushState(null, '', url.pathname + url.search)
    setSelection(selectionFromSearch(url.search))
  }
  const closeProject = useCallback(() => {
    history.pushState(null, '', HOME_PATH)
    setSelection(null)
  }, [])
  const changed = useCallback(() => { void refresh() }, [refresh])
  const index = data?.available ? data : null
  const todos = sortTodos(index?.todos ?? [])

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-bg text-ink [overflow-wrap:anywhere]" data-testid="home-page">
      <div inert={!!selection}>
        <header className="vp-blur vp-safe-pad-top sticky top-0 z-10 border-b border-hairline">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-3">
            <a href={PANEL_PATH} className="vp-control" title={t('home.panel')}><ArrowLeft size={17} /></a>
            <h1 className="min-w-0 text-vp-md font-semibold">{t('home.brand')} · {t('home.title')}</h1>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <button type="button" className="vp-control" onClick={() => void refresh()} disabled={loading} title={t('home.refresh')}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
              <LanguageSwitch testid="home" />
              <ThemeToggle theme={theme} onChange={setTheme} />
              <button type="button" className="vp-control" onClick={onSignOut} title={t('home.signOut')}><LogOut size={16} /></button>
            </div>
          </div>
        </header>
        <main className="vp-safe-bottom mx-auto max-w-[1500px] p-4 [--vp-safe-pad:2rem]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-vp-sm text-ink-2">
            {index && <span>{t('home.generated', { time: '' })}<HomeTime at={index.generatedAt} /></span>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />{t('home.allProjects')}</label>
            <a className="vp-control" href={PANEL_PATH}>{t('home.panel')}</a>
          </div>
          {error && <p role="alert" className="mb-4 rounded-vp border border-hairline bg-surface p-3">{safeText(error)}</p>}
          {!data && loading && <p role="status">{t('home.loading')}</p>}
          {data && !data.available && <section className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="font-semibold">{t('home.unavailable')}</h2><p className="mt-2 text-ink-2">{safeText(data.reason)}</p></section>}
          {index && <>
            <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
              <aside className="min-w-0 self-start rounded-vp-lg border border-hairline bg-surface p-3 md:col-start-2 md:row-start-1" aria-label={t('home.todos', { count: todos.length })}>
                {wide ? <h2 className="flex items-center gap-2 text-vp-md font-semibold"><ClipboardList size={17} />{t('home.todos', { count: todos.length })}</h2> : <button type="button" className="flex w-full items-center gap-2 py-1 text-left text-vp-md font-semibold" onClick={() => setTodosOpen(!todosOpen)} aria-expanded={todosOpen} aria-controls="home-todos"><ClipboardList size={17} />{t('home.todos', { count: todos.length })}<ChevronDown size={16} className={`ml-auto shrink-0 ${todosOpen ? 'rotate-180' : ''}`} /></button>}
                <div id="home-todos" hidden={!wide && !todosOpen} className="mt-3">
                  {!todos.length && <p className="text-vp-base text-ink-2">{t('home.noTodos')}</p>}
                  <ul className="space-y-2">{todos.map((todo) => <li key={todo.id} className="min-w-0 border-t border-hairline pt-2 first:border-0 first:pt-0">
                    <a href={todoLink(todo)} onClick={navigate} className="block rounded-vp px-2 py-1.5 hover:bg-surface-2">
                      <p className="text-vp-xs text-ink-2">{t(todoLabelKey(todo.kind))} · {safeText(todo.projectId)}</p>
                      <p className="mt-1 text-vp-base font-medium">{safeText(todo.title)}</p>
                      {todo.detail && <p className="mt-1 text-vp-sm text-ink-2">{safeText(todo.detail)}</p>}
                      <p className="mt-1 text-vp-xs text-ink-3"><HomeTime at={todo.at} /></p>
                    </a>
                  </li>)}</ul>
                </div>
              </aside>
              <section className="@container min-w-0 md:col-start-1 md:row-start-1" aria-label={t('home.projects')}>
                {!index.projects.length && <p className="rounded-vp-lg border border-hairline bg-surface p-4 text-ink-2">{t('home.emptyProjects')}</p>}
                <div className="grid min-w-0 gap-4 @2xl:grid-cols-2">{index.projects.map((project) => <HomeCard key={project.id} project={project} onNavigate={navigate} />)}</div>
              </section>
            </div>
            {index.warnings.length > 0 && <details className="mt-4 rounded-vp border border-hairline bg-surface p-3 text-vp-sm">
              <summary className="cursor-pointer">{t('home.warnings', { count: index.warnings.length })}</summary>
              <ul className="mt-2 space-y-2 text-ink-2">{index.warnings.map((warning, i) => <li key={i}>{safeText(warning.projectId)} · {safeText(warning.file)}<p>{safeText(warning.message)}</p></li>)}</ul>
            </details>}
          </>}
        </main>
      </div>
      {selection && <HomeProjectView key={selection.projectId} selection={selection} onClose={closeProject} onChanged={changed} onNavigate={navigate} />}
      <ConfirmDialog />
    </div>
  )
}
