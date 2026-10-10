import { useState } from 'react'
import { Send } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeNotifySettings, type HomePatchNotify } from '../../protocol/home'
import { safeText } from '../text'
import { HomeDialog } from './HomeDialog'
import { HomeTime } from './HomeCard'
import { HomeChip } from './HomeField'
import { useHomeResource } from './useHomeResource'
import { useHomeMutation } from './useHomeMutation'

export function HomeNotifications({ onClose }: { onClose: () => void }) {
  const settings = useHomeResource(homeApi.notifySettings, false)
  const deliveries = useHomeResource(homeApi.notifications)
  return <HomeDialog title={t('home.notifications')} onClose={onClose}>
    {(settings.error || deliveries.error) && <p role="alert" className="mb-3 text-vp-sm">{safeText(settings.error || deliveries.error)}</p>}
    {!settings.data && settings.loading && <p role="status">{t('home.loading')}</p>}
    {settings.data && <NotifyForm settings={settings.data} onChanged={async () => { await settings.refresh(); await deliveries.refresh() }} />}
    <section className="mt-5 border-t border-hairline pt-4"><h3 className="mb-3 font-semibold">{t('home.notify.deliveries')}</h3>
      {deliveries.data?.items.length === 0 && <p className="text-vp-sm text-ink-2">{t('home.notify.noDeliveries')}</p>}
      <ul className="space-y-3">{deliveries.data?.items.map((item, index) => <li key={`${item.todoId}:${item.channel}:${index}`} className="rounded-vp border border-hairline p-3 text-vp-sm">
        <div className="flex flex-wrap items-center gap-2"><HomeChip value={item.status} options={[{ value: item.status, label: t(`home.notify.status.${item.status}`), color: item.status === 'sent' ? 'green' : item.status === 'failed' ? 'red' : item.status === 'pending' ? 'orange' : 'gray' }]} /><span>{safeText(item.projectId)}</span><HomeTime at={item.sentAt || item.createdAt} /></div>
        <p className="mt-2 whitespace-pre-wrap">{item.text.split('\n').map((line, i) => <span key={i}>{safeText(line)}{'\n'}</span>)}</p>
      </li>)}</ul>
    </section>
  </HomeDialog>
}

function NotifyForm({ settings, onChanged }: { settings: HomeNotifySettings; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState(settings.mode)
  const [publicUrl, setPublicUrl] = useState(settings.publicUrl)
  const [webhook, setWebhook] = useState('')
  const [secret, setSecret] = useState('')
  const [clearWebhook, setClearWebhook] = useState(false)
  const [clearSecret, setClearSecret] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const { busy, run } = useHomeMutation(onChanged)
  const dirty = mode !== settings.mode || publicUrl !== settings.publicUrl || !!webhook || !!secret || clearWebhook || clearSecret
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault()
    const patch: HomePatchNotify = { mode, publicUrl }
    if (clearWebhook || webhook.trim()) patch.webhookUrl = clearWebhook ? '' : webhook.trim()
    if (clearSecret || secret.trim()) patch.secret = clearSecret ? '' : secret.trim()
    if (await run(() => homeApi.putNotifySettings(patch))) { setWebhook(''); setSecret(''); setClearWebhook(false); setClearSecret(false); setResult(null) }
  }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div><p className="mb-2 text-vp-sm">{t('home.notify.mode')}</p><div className="vp-segmented" role="group" aria-label={t('home.notify.mode')}>{(['off', 'dry_run', 'send'] as const).map((value) => <button type="button" key={value} className="vp-tab px-3 text-vp-sm" aria-pressed={mode === value} data-active={mode === value} disabled={value === 'send' && settings.flagMode === 'off'} onClick={() => setMode(value)}>{t(`home.notify.${value}`)}</button>)}</div>{settings.flagMode === 'off' && <p className="mt-2 text-vp-xs text-ink-2">{t('home.notify.sendForbidden')}</p>}</div>
      {(['webhook', 'secret'] as const).map((key) => {
        const isWebhook = key === 'webhook'
        const cleared = isWebhook ? clearWebhook : clearSecret
        const configured = isWebhook ? settings.webhookConfigured : settings.signed
        return <div key={key}><label className="block text-vp-sm">{t(`home.notify.${key}`)}{configured && <span className="ml-2 text-ink-2">{t('home.notify.configured')}</span>}<input className="home-input mt-1" type="password" autoComplete="new-password" value={isWebhook ? webhook : secret} disabled={cleared} placeholder={t('home.notify.keep')} onChange={(event) => isWebhook ? setWebhook(event.target.value) : setSecret(event.target.value)} /></label><button type="button" className="vp-control mt-1" onClick={() => isWebhook ? setClearWebhook(!cleared) : setClearSecret(!cleared)}>{cleared ? t('home.cancel') : t('home.clear')}</button>{cleared && <span className="ml-2 text-vp-xs">{t('home.notify.cleared')}</span>}</div>
      })}
      <label className="block text-vp-sm">{t('home.notify.publicUrl')}<input className="home-input mt-1" type="url" value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button className="vp-control" type="submit" disabled={!dirty}>{busy ? t('home.saving') : t('home.save')}</button><button className="vp-control" type="button" disabled={dirty || !settings.webhookConfigured} onClick={() => void run(async () => { setResult(await homeApi.testNotification()) })}><Send size={14} />{t('home.notify.test')}</button></div>
      {dirty && <p className="text-vp-xs text-ink-2">{t('home.notify.saveFirst')}</p>}
      {result && <p role={result.ok ? 'status' : 'alert'} className="text-vp-sm">{t(result.ok ? 'home.notify.testOK' : 'home.notify.testFailed')}{result.error && ` · ${safeText(result.error)}`}</p>}
    </fieldset>
  </form>
}
