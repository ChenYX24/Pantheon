import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../protocol/api'
import { homeApi, type HomeResource } from '../../protocol/home'
import { safeText } from '../text'
import { HomeDialog } from './HomeDialog'
import { useHomeMutation } from './useHomeMutation'
import { useHomeResource } from './useHomeResource'

const loadProfiles = async () => (await api.launchProfiles()).map(({ id, name }) => ({ id, name }))

export function HomeResourceImport({ mode, aliases, resources, onChanged, onClose }: {
  mode: 'ssh' | 'profile'
  aliases: string[]
  resources: HomeResource[]
  onChanged: () => Promise<unknown> | void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<{ created: string[]; skipped: string[] } | null>(null)
  const mutation = useHomeMutation(onChanged)
  return <HomeDialog title={t(mode === 'ssh' ? 'home.res.importSSH' : 'home.res.importProfile')} onClose={() => { if (!mutation.busy) onClose() }}>
    {mode === 'profile' ? <ProfileImport resources={resources} busy={mutation.busy} onImport={(profileId, resourceId) => mutation.run(() => homeApi.importProfileResource(profileId, resourceId))} onClose={onClose} /> : <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      if (!selected.length) return
      await mutation.run(async () => { setResult(await homeApi.importSSHResources(selected)); setSelected([]) })
    }}>
      {!aliases.length && <p className="text-vp-sm text-ink-2">{t('home.res.noAliases')}</p>}
      <fieldset className="max-h-64 space-y-2 overflow-y-auto" disabled={mutation.busy}><legend className="mb-2 text-vp-sm">{t('home.res.sshAliases')}</legend>{aliases.map((alias) => <label key={alias} className="flex items-center gap-2 text-vp-sm"><input type="checkbox" checked={selected.includes(alias)} onChange={() => setSelected((old) => old.includes(alias) ? old.filter((item) => item !== alias) : [...old, alias])} /><span>{safeText(alias)}</span></label>)}</fieldset>
      {result && <div role="status" className="space-y-1 text-vp-sm"><p>{t('home.res.imported', { count: result.created.length })} {safeText(result.created.join(', '))}</p><p>{t('home.res.skipped', { count: result.skipped.length })} {safeText(result.skipped.join(', '))}</p></div>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={mutation.busy} onClick={onClose}>{t('home.close')}</button><button type="submit" className="vp-control" disabled={mutation.busy || !selected.length}>{t(mutation.busy ? 'home.saving' : 'home.res.import')}</button></div>
    </form>}
  </HomeDialog>
}

function ProfileImport({ resources, busy, onImport, onClose }: { resources: HomeResource[]; busy: boolean; onImport: (profileId: string, resourceId?: string) => Promise<boolean>; onClose: () => void }) {
  const profiles = useHomeResource(loadProfiles, false)
  const [profileId, setProfileID] = useState('')
  const [resourceId, setResourceID] = useState('')
  const chosen = profileId || profiles.data?.[0]?.id || ''
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault()
    if (chosen && await onImport(chosen, resourceId.trim() || undefined)) onClose()
  }}>
    {profiles.loading && <p role="status">{t('home.loading')}</p>}
    {profiles.error && <p role="alert" className="text-vp-sm">{safeText(profiles.error)}</p>}
    {profiles.data && !profiles.data.length && <p className="text-vp-sm text-ink-2">{t('home.noProfiles')}</p>}
    <label className="block text-vp-sm">{t('home.res.profile')}<select className="home-input mt-1" disabled={busy || !profiles.data?.length} value={chosen} onChange={(event) => setProfileID(event.target.value)}>{profiles.data?.map((profile) => <option key={profile.id} value={profile.id}>{safeText(profile.name)}</option>)}</select></label>
    <label className="block text-vp-sm">{t('home.res.importTarget')}<select className="home-input mt-1" disabled={busy} value={resourceId} onChange={(event) => setResourceID(event.target.value)}><option value="">{t('home.res.new')}</option>{resources.filter((resource) => resource.kind === 'api').map((resource) => <option key={resource.id} value={resource.id}>{safeText(resource.title)} · {safeText(resource.id)}</option>)}</select></label>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy || !chosen}>{t(busy ? 'home.saving' : 'home.res.import')}</button></div>
  </form>
}
