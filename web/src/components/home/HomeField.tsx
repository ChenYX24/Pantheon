import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeFieldOption } from '../../protocol/home'
import { safeText } from '../text'
import { optionColor, optionFor } from './board'
import { HomeDialog } from './HomeDialog'

export function HomeChip({ value, options }: { value: string; options?: HomeFieldOption[] }) {
  const option = optionFor(value, options)
  const color = optionColor(option.color)
  return <span className="inline-flex max-w-full items-center gap-1 rounded-vp border px-1.5 py-0.5 text-vp-xs" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} /><span className="min-w-0 break-words">{safeText(option.label || option.value) || t('home.emptyField')}</span></span>
}

interface FieldProps {
  label: string
  value: string | string[]
  options?: HomeFieldOption[]
  type?: 'text' | 'date'
  required?: boolean
  disabled?: boolean
  onSave: (value: string | string[]) => Promise<boolean>
}

export function HomeField(props: FieldProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState<(FieldProps & { anchor: { top: number; left: number } }) | null>(null)
  const values = Array.isArray(props.value) ? props.value : [props.value]
  return <>
    <button ref={button} type="button" className="vp-control home-wrap-control home-field max-w-full text-left" title={t('home.editField', { field: props.label })} disabled={props.disabled} onClick={() => {
      const rect = button.current!.getBoundingClientRect()
      // Keep the callback as well as the value: it holds the revision that
      // was visible when editing began, even if a poll replaces the row.
      setEditing({ ...props, anchor: { left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 420)) } })
    }}>
      {props.options ? (values.filter(Boolean).length ? values.filter(Boolean) : ['']).map((value) => <HomeChip key={value} value={value} options={props.options} />) : <span className="min-w-0 break-words">{safeText(values.join(', ')) || t('home.emptyField')}</span>}
    </button>
    {editing && <FieldEditor {...editing} onClose={() => setEditing(null)} />}
  </>
}

function FieldEditor({ label, value, options, type, required, onSave, onClose, anchor }: FieldProps & { onClose: () => void; anchor: { top: number; left: number } }) {
  const [draft, setDraft] = useState(typeof value === 'string' && !options ? safeText(value) : value)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const multiple = Array.isArray(draft)
  const selected = multiple ? draft : [draft]
  const choices = [...(options ?? []), ...selected.filter((item) => item && !options?.some((option) => option.value === item)).map((item): HomeFieldOption => ({ value: item, color: 'gray' }))]
  return <HomeDialog title={label} onClose={() => { if (!busy) onClose() }} anchor={anchor}>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      try { if (await onSave(draft)) onClose() } finally { setBusy(false) }
    }}>
      {options ? <>
        <input data-autofocus className="home-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('home.searchOptions')} aria-label={t('home.searchOptions')} />
        <div className="max-h-48 space-y-1 overflow-y-auto" role="group" aria-label={label}>
          {choices.filter((option) => `${option.label ?? ''} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1">
            <input type={multiple ? 'checkbox' : 'radio'} name="option" checked={selected.includes(option.value)} disabled={busy} onChange={() => setDraft(multiple ? selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value] : option.value)} />
            <HomeChip value={option.value} options={choices} />
          </label>)}
        </div>
        {!required && <button type="button" className="vp-control" disabled={busy} onClick={() => setDraft(multiple ? [] : '')}>{t('home.clear')}</button>}
      </> : <input data-autofocus className="home-input" type={type ?? 'text'} required={required} value={typeof draft === 'string' ? draft : draft.join(', ')} onChange={(event) => setDraft(event.target.value)} aria-label={label} disabled={busy} />}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy || (required && !selected.some((item) => item.trim()))}><Check size={14} />{busy ? t('home.saving') : t('home.save')}</button></div>
    </form>
  </HomeDialog>
}
