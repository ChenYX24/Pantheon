import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ArrowDown, Check, Menu, Pencil, Plus, RotateCw, Send, Trash2 } from 'lucide-react'
import { t, type Key } from '../../i18n'
import { HomeAPIError, homeApi, type HomeExecutor, type HomeSuggestion, type HomeThread } from '../../protocol/home'
import { askConfirm, askText } from '../ask'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { chatPending, chatPollInterval, chatReducer, enterSends, initialChat, loadHomeModel, modelDefault, saveHomeModel } from './chat'
import { HomeDialog } from './HomeDialog'
import { HomeTime } from './HomeCard'
import { useHomeResource } from './useHomeResource'
import { useHomeMutation } from './useHomeMutation'

function suggestionLabel(suggestion: HomeSuggestion): string {
  switch (suggestion.type) {
    case 'create_task': return t('home.suggestion.createTask', { title: safeText(suggestion.task.title) })
    case 'set_status': return t('home.suggestion.setStatus', { id: safeText(suggestion.taskId), status: t(`home.status.${suggestion.status}`) })
    case 'create_session': return t('home.suggestion.createSession', { name: safeText(suggestion.name) })
    case 'set_fields': return t('home.suggestion.setFields', { id: safeText(suggestion.taskId) })
    case 'set_project': return t('home.suggestion.setProject')
    case 'reply_report': return t('home.suggestion.replyReport', { file: safeText(suggestion.file) })
  }
}

function SuggestionDetails({ suggestion }: { suggestion: HomeSuggestion }) {
  if (suggestion.type === 'reply_report') return <Markdown text={suggestion.text} />
  if (suggestion.type === 'create_task') return <><p className="text-vp-xs text-ink-2">{safeText([suggestion.task.stage, suggestion.task.primary, suggestion.task.secondary].filter(Boolean).join(' · '))}</p>{suggestion.task.body && <Markdown text={suggestion.task.body} />}</>
  if (suggestion.type !== 'set_fields' && suggestion.type !== 'set_project') return null
  const labels: Record<string, Key> = { title: 'home.table.title', status: 'home.status', priority: 'home.table.priority', tags: 'home.table.tags', owner: 'home.table.owner', due: 'home.table.due', stage: 'home.table.stage', primary: 'home.primary', secondary: 'home.secondary', dependsOn: 'home.dependencies', labels: 'home.table.labels', phase: 'home.table.phase', pinned: 'home.pin', blockedReason: 'home.blockedReason', session: 'home.taskSession', sessionStatus: 'home.sessionStatus' }
  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-vp-xs text-ink-2">{Object.entries(suggestion.fields).map(([key, value]) => <div key={key} className="contents"><dt>{labels[key] ? t(labels[key]) : safeText(key)}</dt><dd>{safeText(Array.isArray(value) ? value.join(', ') : String(value))}</dd></div>)}</dl>
}

export function HomeChat({ projectId, thread, onThread, busy, onSuggestion, revision = 0 }: {
  projectId: string
  thread: string
  onThread: (thread: string) => void
  busy: boolean
  onSuggestion: (suggestion: HomeSuggestion) => Promise<boolean>
  revision?: number
}) {
  const [state, dispatch] = useReducer(chatReducer, thread, initialChat)
  const current = useRef(state)
  useEffect(() => { current.current = state }, [state])
  const [threads, setThreads] = useState<HomeThread[]>([])
  const [menu, setMenu] = useState(false)
  const [version, setVersion] = useState(0)
  const [readError, setReadError] = useState('')
  const [loadedThread, setLoadedThread] = useState('')
  const models = useHomeResource(homeApi.models, false)
  const [chosen, setChosen] = useState(() => loadHomeModel(projectId))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [applied, setApplied] = useState<Set<string>>(() => new Set())
  const [applying, setApplying] = useState('')
  const applyingRef = useRef(false)
  const [retrying, setRetrying] = useState(false)
  const posting = useRef(false)
  const [now, setNow] = useState(Date.now)
  const [scrolledThread, setScrolledThread] = useState<string | null>(null)
  const scrolledUp = scrolledThread === thread
  const nearBottom = useRef(true)
  const scroll = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const refreshThreads = useCallback(() => { setVersion((old) => old + 1) }, [])
  const mutation = useHomeMutation(refreshThreads)
  const executor = models.data ? modelDefault(models.data, chosen) : null
  const pending = chatPending(state)
  const interval = chatPollInterval(state)
  const message = drafts[thread] ?? ''
  const setMessage = (value: string) => setDrafts((old) => ({ ...old, [thread]: value }))

  if (state.thread !== thread) dispatch({ type: 'select', thread })
  useEffect(() => { nearBottom.current = true }, [thread])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let reading = false
    const poll = async () => {
      window.clearTimeout(timer)
      if (document.hidden || reading || controller.signal.aborted) return
      reading = true
      try {
        const list = await homeApi.threads(projectId, controller.signal)
        if (controller.signal.aborted) return
        setThreads(list.threads)
        const knownRun = current.current.run
        const run = knownRun && list.threads.some((item) => item.id === knownRun.thread) ? knownRun : null
        if (knownRun && !run) dispatch({ type: 'delete', thread: knownRun.thread })
        const active = await homeApi.discussion(projectId, thread, controller.signal)
        if (controller.signal.aborted) return
        dispatch({ type: 'snapshot', thread, messages: active.messages })
        setLoadedThread(thread)
        // Thread summaries do not carry run status. Inspect other threads so
        // a reload or another browser cannot enable a second project run.
        const others = run && run.thread !== thread ? [run.thread] : active.messages.some((entry) => entry.status === 'pending') ? [] : list.threads.map((item) => item.id).filter((id) => id !== thread)
        for (const id of others) {
          const result = await homeApi.discussion(projectId, id, controller.signal)
          if (controller.signal.aborted) return
          dispatch({ type: 'snapshot', thread: id, messages: result.messages })
          if (result.messages.some((entry) => entry.status === 'pending')) break
        }
        setReadError('')
      } catch (error) {
        if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : String(error))
      } finally {
        reading = false
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), interval)
      }
    }
    const visible = () => { if (!document.hidden) void poll() }
    void poll()
    document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [projectId, thread, interval, version, revision])

  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pending])
  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [state.messages])
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto'
      textarea.current.style.height = `${Math.min(160, textarea.current.scrollHeight)}px`
    }
  }, [message])
  const harness = executor?.harness
  const model = executor?.model
  useEffect(() => { if (harness && model) saveHomeModel(projectId, { harness, model }) }, [projectId, harness, model])

  const choose = (value: HomeExecutor) => { setChosen(value); saveHomeModel(projectId, value) }
  const send = async () => {
    if (posting.current || pending || !message.trim() || !executor) return
    posting.current = true
    const text = message.trim()
    const sentThread = thread
    setMessage('')
    nearBottom.current = true
    dispatch({ type: 'send', text, at: new Date().toISOString() })
    try {
      const result = await homeApi.sendMessage(projectId, text, executor, sentThread)
      dispatch({ type: 'accepted', thread: sentThread, result })
      refreshThreads()
    } catch (error) {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) })
      setDrafts((old) => ({ ...old, [sentThread]: old[sentThread] || text }))
      if (error instanceof HomeAPIError && error.status === 409) refreshThreads()
    } finally { posting.current = false }
  }

  return <section className="@container flex h-full min-h-0 min-w-0 flex-col" aria-label={t('home.tab.chat')}>
    <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
      <button type="button" className="vp-control" onClick={() => setMenu(true)} title={t('home.threads')}><Menu size={16} /></button>
      <span className="min-w-0 flex-1 truncate text-vp-sm">{safeText(threads.find((item) => item.id === thread)?.title ?? t('home.mainThread'))}</span>
      <button type="button" className="vp-control" disabled={mutation.busy} onClick={() => void mutation.run(async () => { const item = await homeApi.createThread(projectId); onThread(item.id) })}><Plus size={15} />{t('home.newThread')}</button>
    </header>
    {(readError || models.error || state.error) && <div role="alert" className="shrink-0 border-b border-hairline p-3 text-vp-sm"><p>{safeText(state.error || readError || models.error)}</p><button type="button" className="vp-control mt-1" onClick={() => { refreshThreads(); void models.refresh() }}>{t('home.retry')}</button></div>}
    {state.run && state.run.thread !== thread && <p className="shrink-0 border-b border-hairline p-2 text-vp-xs text-ink-2">{t('home.pendingElsewhere')} <button type="button" className="vp-control" onClick={() => onThread(state.run!.thread)}>{t('home.goPending')}</button></p>}
    <div ref={scroll} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3" onScroll={() => {
      if (!scroll.current) return
      nearBottom.current = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 80
      setScrolledThread(nearBottom.current ? null : thread)
    }}>
      {loadedThread !== thread && !state.messages.length && <p role="status" className="text-ink-2">{t('home.loading')}</p>}
      {loadedThread === thread && !state.messages.length && <div className="flex h-full min-h-48 flex-col items-start justify-center gap-3">
        <p className="text-vp-md font-medium">{t('home.noMessages')}</p>
        {(['progress', 'next', 'blockers'] as const).map((key) => <button type="button" className="vp-control home-wrap-control whitespace-normal border border-hairline px-3 py-2 text-left" key={key} onClick={() => { setMessage(t(`home.starter.${key}`)); textarea.current?.focus() }}>{t(`home.starter.${key}`)}</button>)}
      </div>}
      <div role="log" aria-label={t('home.tab.chat')} aria-live="polite" className="space-y-4">{state.messages.map((entry) => <article key={entry.id} className={`min-w-0 rounded-vp-lg p-3 ${entry.role === 'user' ? 'ml-auto max-w-[85%] border border-hairline bg-surface-2' : 'mr-auto max-w-[95%] bg-surface'}`}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-vp-xs text-ink-2"><strong>{t(entry.role === 'user' ? 'home.you' : 'home.manager')}</strong><HomeTime at={entry.at} /></div>
        {entry.role === 'user' ? <p className="whitespace-pre-wrap text-vp-base">{entry.text.replace(/\r\n?/g, '\n').split(/(\n|\t)/).map((part, index) => <span key={index}>{part === '\n' || part === '\t' ? part : safeText(part)}</span>)}</p> : <div className="min-w-0 overflow-hidden"><Markdown text={entry.text} /></div>}
        {entry.status === 'pending' && <p role="status" className="flex items-center gap-2 text-vp-sm text-ink-2"><RotateCw size={14} className="animate-spin" />{t('home.thinkingElapsed', { seconds: Math.max(0, Math.floor((now - (Date.parse(entry.at) || now)) / 1000)) })}</p>}
        {entry.status === 'failed' && <div role="alert" className="mt-2 text-vp-sm"><p>{safeText(entry.error || t('home.replyFailed'))}</p><button type="button" className="vp-control mt-2" disabled={pending || retrying} onClick={async () => {
          if (posting.current) return
          posting.current = true; setRetrying(true)
          try {
            await homeApi.retryMessage(projectId, entry.id)
            dispatch({ type: 'retry', thread, id: entry.id })
            refreshThreads()
          } catch (error) { dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) }); refreshThreads() }
          finally { posting.current = false; setRetrying(false) }
        }}><RotateCw size={14} />{t('home.retry')}</button></div>}
        {entry.suggestedModel && <button type="button" className="vp-control home-wrap-control mt-2 max-w-full whitespace-normal text-left" title={safeText(entry.suggestedModel.reason)} disabled={!models.data?.harnesses.some((item) => item.harness === entry.suggestedModel?.harness && item.installed)} onClick={() => { if (entry.suggestedModel) choose(entry.suggestedModel) }}>{t('home.switchModel', { model: safeText(entry.suggestedModel.model) })}</button>}
        {entry.status === 'done' && entry.suggestions?.map((suggestion, index) => {
          const key = `${entry.id}:${index}`
          return <div key={key} className="mt-2 min-w-0 space-y-1 rounded-vp border border-hairline p-2">
            <SuggestionDetails suggestion={suggestion} />
            <button type="button" className="vp-control home-wrap-control max-w-full whitespace-normal text-left" disabled={busy || !!applying || applied.has(key)} onClick={async () => {
              if (applyingRef.current) return
              applyingRef.current = true; setApplying(key)
              try { if (await onSuggestion(suggestion)) { setApplied((old) => new Set([...old, key])); refreshThreads() } }
              finally { applyingRef.current = false; setApplying('') }
            }}><Check size={14} className="shrink-0" />{applied.has(key) ? t('home.applied') : suggestionLabel(suggestion)}</button>
          </div>
        })}
      </article>)}</div>
    </div>
    {scrolledUp && <button type="button" className="vp-control mx-auto shrink-0" onClick={() => { nearBottom.current = true; setScrolledThread(null); if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }}><ArrowDown size={14} />{t('home.toBottom')}</button>}
    <form className="shrink-0 space-y-2 border-t border-hairline bg-surface p-3" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <textarea ref={textarea} className="home-input max-h-40 resize-none" rows={2} value={message} disabled={pending} aria-label={t('home.message')} placeholder={t('home.messagePlaceholder')} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
        if (enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); void send() }
      }} />
      <div className="flex min-w-0 items-center gap-2"><label className="min-w-0 flex-1"><span className="sr-only">{t('home.model')}</span><select className="home-input" value={executor ? `${executor.harness}:${executor.model}` : ''} onChange={async (event) => {
        const [harness, ...rest] = event.target.value.split(':')
        const model = rest.join(':')
        if (model === '__custom__') {
          const value = await askText({ title: t('home.customModel'), confirm: t('home.confirm'), cancel: t('home.cancel'), field: { label: t('home.model'), value: executor?.harness === harness ? executor.model : '' } })
          if (value?.trim()) choose({ harness: harness as HomeExecutor['harness'], model: value.trim() })
        } else choose({ harness: harness as HomeExecutor['harness'], model })
      }}>
        {!executor && <option value="">{t('home.noExecutors')}</option>}
        {models.data?.harnesses.map((item) => <optgroup key={item.harness} label={`${item.harness}${item.installed ? '' : ` · ${t('home.notInstalled')}`}`} disabled={!item.installed}>
          {[...new Set([item.default, ...item.models, ...(executor?.harness === item.harness ? [executor.model] : [])].filter(Boolean))].map((model) => <option key={model} value={`${item.harness}:${model}`}>{safeText(model)}</option>)}
          <option value={`${item.harness}:__custom__`}>{t('home.customModel')}</option>
        </optgroup>)}
      </select></label><button type="submit" className="vp-control shrink-0" disabled={pending || retrying || !executor || !message.trim()}><Send size={16} />{t('home.send')}</button></div>
      <p className="text-vp-xs text-ink-2">{t('home.readOnlyManager')}</p>
    </form>
    {menu && <HomeDialog title={t('home.threads')} onClose={() => setMenu(false)}><div className="space-y-2">
      <button type="button" className="vp-control" disabled={mutation.busy} onClick={() => void mutation.run(async () => { const item = await homeApi.createThread(projectId); onThread(item.id); setMenu(false) })}><Plus size={14} />{t('home.newThread')}</button>
      {threads.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-1 rounded-vp border border-hairline p-2">
        <button type="button" className="vp-control home-wrap-control min-w-0 flex-1 justify-start whitespace-normal text-left" aria-current={item.id === thread ? 'page' : undefined} onClick={() => { onThread(item.id); setMenu(false) }}><span className="min-w-0">{safeText(item.title)} <span className="text-ink-3">({item.messageCount})</span></span></button>
        <button type="button" className="vp-control" disabled={mutation.busy} title={t('home.renameThread')} onClick={() => void mutation.run(async () => {
          const title = await askText({ title: t('home.renameThread'), confirm: t('home.save'), cancel: t('home.cancel'), field: { label: t('home.threadTitle'), value: item.title } })
          if (!title?.trim()) return false
          await homeApi.renameThread(projectId, item.id, title.trim())
        })}><Pencil size={14} /></button>
        {item.id !== 'main' && <button type="button" className="vp-control" disabled={mutation.busy} title={t('home.remove')} onClick={() => void mutation.run(async () => {
          if (!await askConfirm({ title: t('home.deleteThread'), body: item.title, confirm: t('home.remove'), cancel: t('home.cancel'), destructive: true })) return false
          await homeApi.deleteThread(projectId, item.id)
          dispatch({ type: 'delete', thread: item.id })
          if (thread === item.id) onThread('main')
        })}><Trash2 size={14} /></button>}
      </div>)}
    </div></HomeDialog>}
  </section>
}
