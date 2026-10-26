import { useEffect, useState } from 'react'
import type { AutoRolloverPolicy } from '../../protocol/wire'
import { api } from '../../protocol/api'
import { t, useLang } from '../../i18n'
import { safeText } from '../text'
import { autoRolloverLimits, validAutoRolloverPolicy } from '../rollover'

export function AutoRolloverFields({ policy, busy, onChange }: {
  policy: AutoRolloverPolicy
  busy: boolean
  onChange: (policy: AutoRolloverPolicy) => void
}) {
  useLang()
  return <div className="space-y-3" data-testid="auto-rollover-policy">
    <p className="text-vp-sm text-ink-2">{t('autoRollover.explain')}</p>
    <label className="flex items-center justify-between gap-3 text-vp-sm text-ink-2">{t('autoRollover.enabled')}
      <input type="checkbox" checked={policy.enabled} disabled={busy} onChange={(e) => onChange({ ...policy, enabled: e.target.checked })} />
    </label>
    {autoRolloverLimits.map(([key, min, max]) => <label key={key} className="flex min-w-0 items-center justify-between gap-3 text-vp-sm text-ink-2">
      <span>{t(`autoRollover.${key}`)} <span className="text-ink-3">({min}–{max})</span></span>
      <input type="number" min={min} max={max} step={1} disabled={busy} value={Number.isFinite(policy[key]) ? policy[key] : ''}
        className="w-20 shrink-0 rounded-vp border border-hairline bg-surface-2 px-2 py-1 text-right font-mono text-vp-sm text-ink outline-none focus:border-accent"
        onChange={(e) => onChange({ ...policy, [key]: e.target.valueAsNumber })} />
    </label>)}
    <p className="text-vp-xs text-ink-3">{t('autoRollover.keepOldHint')}</p>
  </div>
}

/** The context trigger, loaded and saved on its own: it is a different
 *  policy from the memory trigger beside it (settings/rollover, not
 *  resources), and the section that holds both is ResourcesGroup's. */
export function AutoRolloverSettings() {
  useLang()
  const [policy, setPolicy] = useState<AutoRolloverPolicy | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    void api.autoRolloverPolicy().then((p) => { if (!stopped) setPolicy(p) }, (e: unknown) => {
      if (!stopped) setError(e instanceof Error ? e.message : String(e))
    })
    return () => { stopped = true }
  }, [])
  const save = async () => {
    if (!policy || !validAutoRolloverPolicy(policy)) return
    setBusy(true)
    setError('')
    try { setPolicy(await api.setAutoRolloverPolicy(policy)); setDirty(false) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div>
    {policy && <AutoRolloverFields policy={policy} busy={busy} onChange={(p) => { setPolicy(p); setDirty(true) }} />}
    {error && <p role="alert" className="text-vp-sm text-state-crashed">{safeText(error)}</p>}
    {policy && dirty && !validAutoRolloverPolicy(policy) && <p role="alert" className="text-vp-sm text-state-waiting">{t('autoRollover.outOfRange')}</p>}
    {policy && dirty && <button type="button" className="vp-control mt-3" disabled={busy || !validAutoRolloverPolicy(policy)} onClick={() => void save()}>{t('res.save')}</button>}
  </div>
}
