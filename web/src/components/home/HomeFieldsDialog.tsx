import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '../../i18n'
import { HOME_FIELD_COLORS, homeApi, type HomeField, type HomeFieldColor, type HomeFields, type HomeFieldSettings } from '../../protocol/home'
import { askConfirm } from '../ask'
import { safeText } from '../text'
import { HomeDialog } from './HomeDialog'
import { HomeChip } from './HomeField'
import { useHomeMutation } from './useHomeMutation'

const names = ['task.status', 'task.priority', 'task.tags', 'project.labels', 'project.priority', 'project.phase'] as const
type FieldName = typeof names[number]
function fieldFor(fields: HomeFields, name: FieldName): HomeField {
  const [scope, field] = name.split('.')
  return scope === 'task' ? fields.task[field as keyof HomeFields['task']] : fields.project[field as keyof HomeFields['project']]
}

export function HomeFieldsDialog({ settings, onClose, onChanged }: { settings: HomeFieldSettings; onClose: () => void; onChanged: () => Promise<unknown> | void }) {
  const [draft, setDraft] = useState(() => structuredClone(settings.fields))
  const [name, setName] = useState<FieldName>('task.status')
  const { busy, run } = useHomeMutation(onChanged)
  const options = fieldFor(draft, name).options
  const fixed = name === 'task.status'
  const invalid = names.some((name) => {
    const values = fieldFor(draft, name).options.map((option) => option.value.trim())
    return values.some((value) => !value) || new Set(values).size !== values.length
  })
  const update = (change: (field: HomeField) => void) => setDraft((old) => {
    const next = structuredClone(old)
    change(fieldFor(next, name))
    return next
  })

  return <HomeDialog title={t('home.fields')} onClose={() => { if (!busy) onClose() }}>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      if (!invalid && await run(() => homeApi.putFields({ rev: settings.rev, fields: draft }))) onClose()
    }}>
      <label className="block text-vp-sm">{t('home.field')}<select className="home-input mt-1" value={name} disabled={busy} onChange={(event) => setName(event.target.value as FieldName)}>
        {names.map((item) => <option key={item} value={item}>{t(item.startsWith('task.') ? 'home.table.tasks' : 'home.table.projects')} · {item === 'task.status' ? t('home.status') : t(`home.table.${item.split('.')[1] as 'priority' | 'tags' | 'labels' | 'phase'}`)}</option>)}
      </select></label>
      {fixed && <p className="text-vp-sm text-ink-2">{t('home.fixedStatus')}</p>}
      <div className="space-y-3">{options.map((option, index) => <div key={index} className="rounded-vp border border-hairline p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><HomeChip value={option.value} options={options} />{!fixed && <button type="button" className="vp-control" disabled={busy} title={t('home.remove')} onClick={async () => {
          if (await askConfirm({ title: t('home.removeOption'), body: option.label || option.value, confirm: t('home.remove'), cancel: t('home.cancel'), destructive: true })) update((field) => { field.options.splice(index, 1) })
        }}><Trash2 size={14} /></button>}</div>
        <div className="grid min-w-0 gap-2 @lg:grid-cols-3">
          <label className="min-w-0 text-vp-xs">{t('home.optionValue')}<input className="home-input mt-1" value={safeText(option.value)} disabled={busy || fixed} required onChange={(event) => update((field) => { field.options[index].value = event.target.value })} /></label>
          <label className="min-w-0 text-vp-xs">{t('home.optionLabel')}<input className="home-input mt-1" value={safeText(option.label ?? '')} disabled={busy} onChange={(event) => update((field) => { field.options[index].label = event.target.value })} /></label>
          <label className="min-w-0 text-vp-xs">{t('home.optionColor')}<select className="home-input mt-1" value={option.color} disabled={busy} onChange={(event) => update((field) => { field.options[index].color = event.target.value as HomeFieldColor })}>{HOME_FIELD_COLORS.map((color) => <option key={color} value={color}>{t(`home.color.${color}`)}</option>)}</select></label>
        </div>
      </div>)}</div>
      {!fixed && <button type="button" className="vp-control" disabled={busy} onClick={() => update((field) => { field.options.push({ value: '', color: 'gray' }) })}><Plus size={14} />{t('home.addOption')}</button>}
      {invalid && <p role="status" className="text-vp-sm text-ink-2">{t('home.fieldInvalid')}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy || invalid}>{busy ? t('home.saving') : t('home.save')}</button></div>
    </form>
  </HomeDialog>
}
