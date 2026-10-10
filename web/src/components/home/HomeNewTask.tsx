import { useState } from 'react'
import { t } from '../../i18n'
import type { HomeCreateTask } from '../../protocol/home'

const field = 'mt-1 w-full min-w-0 rounded-vp border border-hairline bg-surface px-3 py-2 text-vp-base text-ink'

export function NewTask({ busy, onCreate }: { busy: boolean; onCreate: (task: HomeCreateTask) => Promise<boolean> }) {
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
