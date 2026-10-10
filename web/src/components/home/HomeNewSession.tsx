import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../protocol/api'
import type { HomeCreateSession, HomeProjectResources } from '../../protocol/home'
import { safeText } from '../text'
import { HomeDialog } from './HomeDialog'
import { HomeResourceChoices } from './HomeProjectResources'
import { selectedResources } from './resources'
import { useHomeResource } from './useHomeResource'

const loadProfiles = async () => (await api.launchProfiles()).map(({ id, name }) => ({ id, name }))

export function HomeNewSession({ resources, busy, onCreate, onClose }: { resources: HomeProjectResources; busy: boolean; onCreate: (session: HomeCreateSession) => Promise<boolean>; onClose: () => void }) {
  const profiles = useHomeResource(loadProfiles, false)
  const [name, setName] = useState('')
  const [profileId, setProfileID] = useState('')
  const [selected, setSelected] = useState(() => selectedResources(resources.resources, resources.defaultResources))
  return <HomeDialog title={t('home.newSession')} onClose={() => { if (!busy) onClose() }}>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      // [] means the person deselected every default; omission would let the
      // backend reapply them and inject keys the person explicitly removed.
      if (await onCreate({ ...(name.trim() ? { name: name.trim() } : {}), ...(profileId ? { profileId } : {}), resources: selected })) onClose()
    }}>
      <label className="block text-vp-sm">{t('home.sessionName')}<input data-autofocus className="home-input mt-1" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label className="block text-vp-sm">{t('home.res.profile')}<select className="home-input mt-1" value={profileId} disabled={busy || profiles.loading} onChange={(event) => setProfileID(event.target.value)}><option value="">{t('home.plainShell')}</option>{profiles.data?.map((profile) => <option key={profile.id} value={profile.id}>{safeText(profile.name)}</option>)}</select></label>
      {profiles.error && <p role="alert" className="text-vp-sm">{safeText(profiles.error)}</p>}
      <HomeResourceChoices resources={resources.resources} value={selected} disabled={busy} onChange={setSelected} />
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy}>{t(busy ? 'home.saving' : 'home.newSession')}</button></div>
    </form>
  </HomeDialog>
}
