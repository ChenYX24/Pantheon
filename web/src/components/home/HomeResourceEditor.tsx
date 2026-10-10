import { useState } from 'react'
import { t } from '../../i18n'
import { HOME_RESOURCE_CHECKS, HOME_RESOURCE_KINDS, HOME_RESOURCE_PROVIDERS, type HomeCreateResource, type HomeProject, type HomeResource, type HomeResourceFields } from '../../protocol/home'
import { Markdown } from '../panels/Rendered'
import { safeBody, safeText } from '../text'
import { HomeDialog } from './HomeDialog'
import { resourceNames, toggleResourceScope } from './resources'

export function HomeResourceScope({ value, projects, disabled, onChange }: { value: string[]; projects: Pick<HomeProject, 'id'>[]; disabled: boolean; onChange: (value: string[]) => void }) {
  const ids = [...new Set([...projects.map((project) => project.id), ...value.filter((id) => id !== '*')])]
  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-2 text-vp-sm font-medium">{t('home.res.scope')}</legend>
    <label className="flex items-center gap-2 text-vp-sm"><input type="checkbox" checked={value.includes('*')} onChange={() => onChange(toggleResourceScope(value, '*'))} />{t('home.res.allProjects')}</label>
    <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-2 overflow-y-auto">{ids.map((id) => <label key={id} className="flex min-w-0 items-start gap-2 text-vp-sm"><input type="checkbox" className="mt-1 shrink-0" disabled={value.includes('*')} checked={value.includes('*') || value.includes(id)} onChange={() => onChange(toggleResourceScope(value, id))} /><span>{safeText(id)}</span></label>)}</div>
    {!value.length && <p className="text-vp-xs text-ink-2">{t('home.res.noScope')}</p>}
  </fieldset>
}

export function HomeResourceEditor({ resource, projects, aliases, busy, onSave, onClose }: {
  resource?: HomeResource
  projects: HomeProject[]
  aliases: string[]
  busy: boolean
  onSave: (fields: HomeCreateResource) => Promise<boolean>
  onClose: () => void
}) {
  const [id, setID] = useState(resource?.id ?? '')
  const [fields, setFields] = useState<HomeResourceFields>(() => ({
    kind: resource?.kind ?? 'api', title: safeText(resource?.title ?? ''), provider: resource?.provider ?? 'openai',
    baseUrl: resource?.baseUrl ?? '', env: resource?.env ?? [], sshAlias: resource?.sshAlias ?? '',
    gpuBoardId: resource?.gpuBoardId ?? '', url: resource?.url ?? '', projects: resource?.projects ?? ['*'],
    tags: resource?.tags ?? [], check: resource?.check ?? 'provider', body: safeBody(resource?.body ?? t('home.res.bodyTemplate')),
  }))
  const [env, setEnv] = useState(fields.env.join(', '))
  const [tags, setTags] = useState(fields.tags.join(', '))
  const names = resourceNames(env)
  const badEnv = names.some((name) => !/^[A-Z_][A-Z0-9_]{0,63}$/.test(name))
  const patch = (value: Partial<HomeResourceFields>) => setFields((old) => ({ ...old, ...value }))
  const serverAliases = [...new Set([...aliases, ...(fields.sshAlias ? [fields.sshAlias] : [])])]
  return <HomeDialog title={t(resource ? 'home.res.edit' : 'home.res.new')} onClose={() => { if (!busy) onClose() }}>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      if (busy || badEnv || !fields.title.trim()) return
      if (await onSave({ ...fields, title: fields.title.trim(), env: names, tags: resourceNames(tags), ...(!resource && id.trim() ? { id: id.trim() } : {}) })) onClose()
    }}>
      <fieldset disabled={busy} className="@container min-w-0 space-y-4">
        <label className="block text-vp-sm">{t('home.res.titleField')}<input data-autofocus required className="home-input mt-1" value={fields.title} onChange={(event) => patch({ title: event.target.value })} /></label>
        {!resource && <label className="block text-vp-sm">{t('home.res.id')}<input className="home-input mt-1" pattern="[a-z0-9][a-z0-9._-]{0,63}" maxLength={64} value={id} onChange={(event) => setID(event.target.value)} placeholder={t('home.res.idOptional')} /></label>}
        <div className="grid min-w-0 gap-3 @lg:grid-cols-2">
          <label className="block text-vp-sm">{t('home.res.kind')}<select className="home-input mt-1" value={fields.kind} onChange={(event) => {
            const kind = event.target.value as HomeResourceFields['kind']
            patch({ kind, check: kind === 'api' ? 'provider' : kind === 'server' ? 'ssh' : 'none' })
          }}>{HOME_RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`home.res.kind.${kind}`)}</option>)}</select></label>
          <label className="block text-vp-sm">{t('home.res.checkMethod')}<select className="home-input mt-1" value={fields.check} onChange={(event) => patch({ check: event.target.value as HomeResourceFields['check'] })}>{HOME_RESOURCE_CHECKS.map((check) => <option key={check} value={check}>{t(`home.res.check.${check}`)}</option>)}</select></label>
        </div>
        {(fields.kind === 'api' || fields.check === 'provider') && <>
          <label className="block text-vp-sm">{t('home.res.provider')}<select className="home-input mt-1" value={fields.provider} onChange={(event) => patch({ provider: event.target.value as HomeResourceFields['provider'] })}><option value="">{t('home.res.unknown')}</option>{HOME_RESOURCE_PROVIDERS.map((provider) => <option key={provider} value={provider}>{t(`home.res.provider.${provider}`)}</option>)}</select></label>
          <label className="block text-vp-sm">{t('home.res.baseUrl')}<input className="home-input mt-1" type="url" value={fields.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /></label>
        </>}
        {(fields.kind === 'server' || fields.check === 'ssh') && <>
          <label className="block text-vp-sm">{t('home.res.sshAlias')}<select className="home-input mt-1" value={fields.sshAlias} onChange={(event) => patch({ sshAlias: event.target.value })}><option value="">{t('home.res.chooseAlias')}</option>{serverAliases.map((alias) => <option key={alias} value={alias}>{safeText(alias)}</option>)}</select></label>
          <label className="block text-vp-sm">{t('home.res.gpuBoardId')}<input className="home-input mt-1" value={fields.gpuBoardId} onChange={(event) => patch({ gpuBoardId: event.target.value })} /></label>
        </>}
        {(!['api', 'server'].includes(fields.kind) || fields.check === 'http') && <label className="block text-vp-sm">{t('home.res.url')}<input className="home-input mt-1" value={fields.url} onChange={(event) => patch({ url: event.target.value })} /></label>}
        <label className="block text-vp-sm">{t('home.res.env')}<input className="home-input mt-1" value={env} onChange={(event) => setEnv(event.target.value)} aria-invalid={badEnv} /></label>
        {badEnv && <p role="alert" className="text-vp-xs">{t('home.res.invalidEnv')}</p>}
        <label className="block text-vp-sm">{t('home.res.tags')}<input className="home-input mt-1" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        <HomeResourceScope value={fields.projects} projects={projects} disabled={busy} onChange={(projects) => patch({ projects })} />
        <label className="block text-vp-sm">{t('home.res.usageDoc')}<textarea className="home-input mt-1 resize-y font-mono" rows={8} value={fields.body} onChange={(event) => patch({ body: event.target.value })} /></label>
        <details className="min-w-0 rounded-vp border border-hairline p-3"><summary className="cursor-pointer text-vp-sm">{t('home.res.preview')}</summary><div className="mt-2 min-w-0 overflow-hidden"><Markdown text={fields.body} /></div></details>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vp-control" disabled={busy} onClick={onClose}>{t('home.cancel')}</button><button type="submit" className="vp-control" disabled={busy || !fields.title.trim() || badEnv}>{t(busy ? 'home.saving' : 'home.save')}</button></div>
    </form>
  </HomeDialog>
}
