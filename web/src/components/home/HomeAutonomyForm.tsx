import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeProject, HomeTask } from '../../protocol/home'
import { safeText } from '../text'
import { autonomyDraft, autonomyError, taskStages, toggleApprovedStage, type HomeAutonomyDraft } from './execution'

export function HomeAutonomyForm({ project, tasks, busy, onSave }: {
  project: HomeProject
  tasks: HomeTask[]
  busy: boolean
  onSave: (draft: HomeAutonomyDraft) => Promise<boolean>
}) {
  // Polls update the idle form. The first edit pins both values and revision,
  // so a later save cannot silently overwrite another person's approval.
  const [draft, setDraft] = useState<HomeAutonomyDraft | null>(null)
  const value = draft ?? autonomyDraft(project.meta, project.metaRev)
  const patch = (changes: Partial<HomeAutonomyDraft>) => setDraft({ ...value, ...changes })
  const error = autonomyError(value)
  const stages = taskStages(tasks)
  return <form className="min-w-0 space-y-3 rounded-vp border border-hairline bg-surface p-3" onSubmit={async (event) => {
    event.preventDefault()
    if (!draft || busy || error) return
    if (await onSave(draft)) setDraft(null)
  }}>
    <fieldset className="@container min-w-0 space-y-3" disabled={busy}>
      <legend className="mb-2 text-vp-sm font-semibold">{t('home.exec.autonomy')}</legend>
      <div className="vp-segmented" role="group" aria-label={t('home.exec.autonomy')}>{(['off', 'stage', 'full'] as const).map((autonomy) => <button type="button" key={autonomy} className="vp-tab h-auto py-2 text-vp-sm" data-active={value.autonomy === autonomy} aria-pressed={value.autonomy === autonomy} onClick={() => patch({ autonomy })}>{t(`home.exec.autonomy.${autonomy}`)}</button>)}</div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-vp-sm font-medium">{t('home.exec.stages')}</h3>
        <div className="flex min-w-0 flex-wrap gap-2">{stages.map((stage) => {
          const approved = value.approvedStages.includes(stage)
          const Icon = approved ? Check : Plus
          return <button type="button" key={stage} className="vp-control home-wrap-control" aria-pressed={approved} aria-label={t(approved ? 'home.exec.revokeStage' : 'home.exec.approveStage', { stage: safeText(stage) })} onClick={() => patch({ approvedStages: toggleApprovedStage(value.approvedStages, stage) })}><Icon size={14} className="shrink-0" />{safeText(stage)}</button>
        })}</div>
        {!stages.length && <p className="text-vp-xs text-ink-2">{t('home.exec.noStages')}</p>}
        <p className="text-vp-xs text-ink-2">{t('home.exec.revokeHint')}</p>
      </div>
      <label className="flex items-start gap-2 text-vp-sm"><input type="checkbox" className="mt-1 shrink-0" checked={value.autoMerge} onChange={(event) => patch({ autoMerge: event.target.checked })} />{t('home.exec.autoMerge')}</label>
      <div className="grid min-w-0 gap-3 @lg:grid-cols-2">
        <label className="min-w-0 text-vp-sm">{t('home.exec.attempts')}<input className="home-input mt-1" type="number" inputMode="numeric" min={1} max={3} step={1} required value={value.maxAttempts} onChange={(event) => patch({ maxAttempts: event.target.value })} /></label>
        <label className="min-w-0 text-vp-sm">{t('home.exec.minutes')}<input className="home-input mt-1" type="number" inputMode="numeric" min={5} max={120} step={1} required value={value.attemptMinutes} onChange={(event) => patch({ attemptMinutes: event.target.value })} /></label>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-vp-xs">{error}</p>}
    {draft && draft.rev !== project.metaRev && <p role="status" className="text-vp-xs text-ink-2">{t('home.conflict')}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="vp-control home-wrap-control" disabled={busy || !draft} onClick={() => setDraft(null)}>{t('home.exec.reset')}</button>
      <button type="submit" className="vp-control" disabled={busy || !draft || !!error}>{t(busy ? 'home.saving' : 'home.save')}</button>
    </div>
  </form>
}
