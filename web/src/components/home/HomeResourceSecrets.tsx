import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { homeApi, type HomeResource, type HomeResourceSecret } from '../../protocol/home'
import { askConfirm } from '../ask'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { HomeDialog } from './HomeDialog'
import { emptySecretDraft, resourceSecrets, secretEdits, secretValueFits } from './resources'

export function HomeSecretFields({ secrets, draft, busy, onChange, onRemove }: {
  secrets: HomeResourceSecret[]
  draft: Record<string, string>
  busy: boolean
  onChange: (name: string, value: string) => void
  onRemove: (name: string) => void
}) {
  return <div className="space-y-4">{secrets.map((secret) => <div key={secret.name} className="min-w-0 space-y-1">
    <label className="block text-vp-sm"><span>{safeText(secret.name)}</span><input className="home-input mt-1" type="password" autoComplete="off" spellCheck={false} value={draft[secret.name] ?? ''} disabled={busy} onChange={(event) => onChange(secret.name, event.target.value)} /></label>
    <div className="flex flex-wrap items-center gap-1 text-vp-xs text-ink-2"><span>{t(secret.configured ? 'home.res.configured' : 'home.res.unconfigured')}</span>{secret.updatedAt && <><span>· {t('home.res.updated')}</span><HomeTime at={secret.updatedAt} /></>}{secret.configured && <button type="button" className="vp-control" disabled={busy} onClick={() => onRemove(secret.name)}>{t('home.res.removeSecret')}</button>}</div>
  </div>)}</div>
}

export function HomeResourceSecrets({ resource, onChanged, onClose }: { resource: HomeResource; onChanged: () => Promise<unknown> | void; onClose: () => void }) {
  const [secrets, setSecrets] = useState(() => resourceSecrets(resource))
  const [draft, setDraft] = useState(() => emptySecretDraft(secrets))
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState('')
  const edits = secretEdits(draft)
  const tooLarge = edits.some((edit) => !secretValueFits(edit.value))
  const remove = async (name: string) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    try {
      if (!await askConfirm({ title: t('home.res.removeSecret'), body: safeText(name), confirm: t('home.remove'), cancel: t('home.cancel'), destructive: true })) return
      await homeApi.deleteResourceSecret(resource.id, name)
      setSecrets((old) => old.map((secret) => secret.name === name ? { ...secret, configured: false, updatedAt: '' } : secret))
      setDraft((old) => ({ ...old, [name]: '' }))
      await onChanged()
    } catch { setError(t('home.res.secretFailed')) }
    finally { locked.current = false; setBusy(false) }
  }
  return <HomeDialog title={`${t('home.res.setSecrets')} · ${safeText(resource.title)}`} onClose={() => { if (!locked.current) onClose() }}>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      if (locked.current || !edits.length || tooLarge) return
      locked.current = true; setBusy(true); setError('')
      try {
        for (const { name, value } of edits) {
          const saved = await homeApi.putResourceSecret(resource.id, name, value)
          setSecrets((old) => old.map((secret) => secret.name === name ? saved : secret))
          setDraft((old) => ({ ...old, [name]: '' }))
        }
        await onChanged()
        onClose()
      } catch {
        // A proxy error can echo the submitted body. Never put a secret-write
        // error into a toast, even though the resource API redacts its errors.
        setError(t('home.res.secretFailed'))
        await onChanged()
      } finally { locked.current = false; setBusy(false) }
    }}>
      <p className="text-vp-sm text-ink-2">{t('home.res.keepSecrets')}</p>
      {!secrets.length && <p className="text-vp-sm">{t('home.res.noSecretNames')}</p>}
      <HomeSecretFields secrets={secrets} draft={draft} busy={busy} onChange={(name, value) => setDraft((old) => ({ ...old, [name]: value }))} onRemove={(name) => void remove(name)} />
      {(error || tooLarge) && <p role="alert" className="text-vp-sm">{error || t('home.res.secretTooLarge')}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy || !edits.length || tooLarge}>{t(busy ? 'home.saving' : 'home.save')}</button></div>
    </form>
  </HomeDialog>
}
