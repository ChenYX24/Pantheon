import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { t } from '../../i18n'
import { HOME_TASK_STATUSES, type HomeCreateTask, type HomeTask, type HomeTaskStatus } from '../../protocol/home'
import { panelOpeningSession } from '../../routes'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'

const field = 'mt-1 w-full min-w-0 rounded-vp border border-hairline bg-surface px-3 py-2 text-vp-base text-ink'

export function HomeTasks({ tasks, target, active, busy, onStatus, onCreate }: {
  tasks: HomeTask[]
  target?: string
  active: boolean
  busy: boolean
  onStatus: (task: HomeTask, status: HomeTaskStatus) => Promise<boolean>
  onCreate: (task: HomeCreateTask) => Promise<boolean>
}) {
  const [creating, setCreating] = useState(false)
  const groups = new Map<string, HomeTask[]>()
  for (const task of tasks) groups.set(task.stage, [...(groups.get(task.stage) ?? []), task])

  useEffect(() => {
    if (active && target) document.getElementById(`home-task-${target}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, target, tasks.length])

  return <section className="space-y-4" aria-label={t('home.tab.tasks')}>
    <button type="button" className="vp-control" aria-expanded={creating} onClick={() => setCreating(!creating)}><Plus size={16} />{t('home.newTask')}</button>
    <div hidden={!creating}><NewTask busy={busy} onCreate={async (task) => {
      const saved = await onCreate(task)
      if (saved) setCreating(false)
      return saved
    }} /></div>
    {!tasks.length && <p className="text-ink-2">{t('home.noTasks')}</p>}
    {target && !tasks.some((task) => task.id === target) && <p role="status" className="text-ink-2">{t('home.taskMissing')}</p>}
    {[...groups.entries()].map(([stage, items]) => <section key={stage} className="space-y-3">
      <h3 className="text-vp-md font-semibold">{stage ? t('home.stage', { name: safeText(stage) }) : t('home.ungrouped')}</h3>
      {items.map((task) => <article id={`home-task-${task.id}`} key={task.id} data-testid="home-task" className={`min-w-0 scroll-mt-4 rounded-vp border bg-surface p-3 ${target === task.id ? 'border-accent' : 'border-hairline'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><h4 className="text-vp-md font-medium">{safeText(task.id)} · {safeText(task.title)}</h4><p className="mt-1 text-vp-xs text-ink-2"><HomeTime at={task.updated} /></p></div>
          <label className="w-full text-vp-sm @lg:w-auto">{t('home.status')}
            <select className={field} value={task.status} disabled={busy} aria-label={`${safeText(task.id)} · ${t('home.status')}`} onChange={(event) => void onStatus(task, event.target.value as HomeTaskStatus)}>
              {HOME_TASK_STATUSES.map((status) => <option key={status} value={status}>{t(`home.status.${status}`)}</option>)}
            </select>
          </label>
        </div>
        {task.blockedReason && <p className="mt-2 text-vp-base">{t('home.blockedReason')}: {safeText(task.blockedReason)}</p>}
        {task.sessionStatus === 'rollover_due' && <p className="mt-2 text-vp-sm">{t('home.todo.session_rollover')}</p>}
        <dl className="mt-3 grid min-w-0 gap-2 text-vp-sm text-ink-2 @lg:grid-cols-2">
          {task.primary && <div><dt>{t('home.primary')}</dt><dd className="text-ink">{safeText(task.primary)}</dd></div>}
          {task.secondary && <div><dt>{t('home.secondary')}</dt><dd className="text-ink">{safeText(task.secondary)}</dd></div>}
        </dl>
        {task.dependsOn.length > 0 && <p className="mt-2 text-vp-sm text-ink-2">{t('home.dependsOn', { ids: safeText(task.dependsOn.join(', ')) })}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-vp-xs text-ink-2">
          <span>{t('home.handoffs', { count: task.handoffs })}</span>
          {task.session && <a className="vp-control" href={panelOpeningSession(task.session)}>{t('home.openTerminal')}</a>}
        </div>
        {task.body && <details className="mt-2" open={target === task.id ? true : undefined}><summary className="cursor-pointer text-vp-sm">{t('home.taskDetails')}</summary><div className="min-w-0 overflow-hidden"><Markdown text={task.body} /></div></details>}
      </article>)}
    </section>)}
  </section>
}

function NewTask({ busy, onCreate }: { busy: boolean; onCreate: (task: HomeCreateTask) => Promise<boolean> }) {
  const [draft, setDraft] = useState({ title: '', stage: '', primary: '', secondary: '', body: '', id: '', dependencies: '' })
  const update = (key: keyof typeof draft, value: string) => setDraft((old) => ({ ...old, [key]: value }))
  return <form className="min-w-0 space-y-3 rounded-vp border border-hairline bg-surface-2 p-3" onSubmit={async (event) => {
    event.preventDefault()
    const saved = await onCreate({
      title: draft.title.trim(), stage: draft.stage.trim(), primary: draft.primary.trim(), secondary: draft.secondary.trim(), body: draft.body,
      ...(draft.id.trim() ? { id: draft.id.trim() } : {}),
      dependsOn: draft.dependencies.split(/[,，]/).map((id) => id.trim()).filter(Boolean),
    })
    if (saved) setDraft({ title: '', stage: '', primary: '', secondary: '', body: '', id: '', dependencies: '' })
  }}>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
    <label className="block text-vp-sm">{t('home.taskTitle')}<input required className={field} value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
    <label className="block text-vp-sm">{t('home.taskStage')}<input className={field} value={draft.stage} onChange={(event) => update('stage', event.target.value)} /></label>
    <label className="block text-vp-sm">{t('home.taskBody')}<textarea className={field} rows={4} value={draft.body} onChange={(event) => update('body', event.target.value)} /></label>
    <details><summary className="cursor-pointer text-vp-sm">{t('home.moreFields')}</summary>
      <div className="mt-3 grid min-w-0 gap-3 @lg:grid-cols-2">
        <label className="min-w-0 text-vp-sm">{t('home.primary')}<input className={field} placeholder={t('home.executorFormat')} value={draft.primary} onChange={(event) => update('primary', event.target.value)} /></label>
        <label className="min-w-0 text-vp-sm">{t('home.secondary')}<input className={field} placeholder={t('home.executorFormat')} value={draft.secondary} onChange={(event) => update('secondary', event.target.value)} /></label>
        <label className="min-w-0 text-vp-sm">{t('home.taskId')}<input className={field} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" value={draft.id} onChange={(event) => update('id', event.target.value)} /></label>
        <label className="min-w-0 text-vp-sm">{t('home.dependencies')}<input className={field} value={draft.dependencies} onChange={(event) => update('dependencies', event.target.value)} /></label>
      </div>
    </details>
    <button type="submit" className="vp-control" disabled={busy || !draft.title.trim()}>{busy ? t('home.saving') : t('home.createTask')}</button>
    </fieldset>
  </form>
}
