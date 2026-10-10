import type { MouseEvent } from 'react'
import { Boxes } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeProjectResources, HomeResource } from '../../protocol/home'
import { HOME_RESOURCES_PATH, homeResourceLink } from '../../routes'
import { safeText } from '../text'
import { HomeChip, HomeField } from './HomeField'
import { selectedResources } from './resources'

export function HomeResourceChoices({ resources, value, disabled, onChange }: {
  resources: HomeResource[]
  value: string[]
  disabled: boolean
  onChange: (value: string[]) => void
}) {
  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-2 text-vp-sm font-medium">{t('home.res.sessionResources')}</legend>
    {!resources.length && <p className="text-vp-sm text-ink-2">{t('home.res.noAvailable')}</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto">{resources.map((resource) => <label key={resource.id} className="flex min-w-0 items-start gap-2 text-vp-sm"><input className="mt-1 shrink-0" type="checkbox" checked={value.includes(resource.id)} onChange={() => onChange(value.includes(resource.id) ? value.filter((id) => id !== resource.id) : [...value, resource.id])} /><span className="min-w-0"><span className="block">{safeText(resource.title)}</span><span className="text-vp-xs text-ink-2">{safeText(resource.id)} · {t(`home.res.kind.${resource.kind}`)}</span></span></label>)}</div>
  </fieldset>
}

export function HomeProjectResourceSettings({ data, error, busy, onSave, onRetry, onNavigate }: {
  data: HomeProjectResources | null
  error: string
  busy: boolean
  onSave: (resources: string[]) => Promise<boolean>
  onRetry: () => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return <section className="min-w-0 space-y-3 border-t border-hairline pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('home.res.available')}</h2><a className="vp-control" href={HOME_RESOURCES_PATH} onClick={onNavigate}><Boxes size={14} />{t('home.res.title')}</a></div>
    {error && <div role="alert" className="text-vp-sm"><p>{safeText(error)}</p><button type="button" className="vp-control mt-1" onClick={onRetry}>{t('home.retry')}</button></div>}
    {!data && !error && <p role="status">{t('home.loading')}</p>}
    {data && <>
      {!data.resources.length && <p className="text-vp-sm text-ink-2">{t('home.res.noAvailable')}</p>}
      <div className="flex flex-wrap gap-2">{data.resources.map((resource) => <a key={resource.id} className="max-w-full" href={homeResourceLink(resource.id)} onClick={onNavigate}><HomeChip value={resource.title} /></a>)}</div>
      <div className="space-y-1"><p className="text-vp-sm font-medium">{t('home.res.defaults')}</p><HomeField label={t('home.res.defaults')} value={data.defaultResources} options={data.resources.map((resource) => ({ value: resource.id, label: resource.title, color: 'gray' }))} disabled={busy} onSave={(value) => onSave(selectedResources(data.resources, Array.isArray(value) ? value : []))} /></div>
    </>}
  </section>
}
