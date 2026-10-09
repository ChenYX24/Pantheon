import { appFetch } from '../basePath'
import { t, useLang } from '../i18n'
import { workflowRequest as request } from '../protocol/workflow'
import { useEffect, useState } from 'react'
import type { Board } from './ProjectBoard'

interface Source { name: string; kind: string; scope: string; path: string; digest: string; content?: string }
interface Recipient { channel: string; peerId: string; name: string }
interface Notice { id: string; stageId: string; state: string; channel: string; lastError: string }
const field = 'w-full min-w-0 rounded-md border border-hairline bg-surface p-2 text-ink'


export function CapabilityInventory({ projectId, onDraft }: { projectId: string; onDraft: (value: { name: string; kind: string; content: string }) => void }) {
  useLang()
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (projectId) void request<Source[]>(`/api/projects/${projectId}/capability-inventory`).then((items) => { if (!cancelled) setSources(items) }).catch((e: unknown) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [projectId])
  return <details className="mb-4 rounded-vp-lg border border-hairline bg-surface p-4">
    <summary className="cursor-pointer font-semibold">{t('pm.inventoryCount', { count: sources.length })}</summary>
    <p className="my-3 text-vp-base text-ink-2">{t('pm.inventoryHelp')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="grid gap-3 @3xl:grid-cols-2">{sources.map((source) => <article key={`${source.path}-${source.name}`} className="min-w-0 rounded-vp border border-hairline p-3">
      <h3 className="break-words font-semibold">{source.name}</h3><p className="text-vp-base text-ink-2">{source.kind} · {source.scope}</p><p className="my-2 break-all text-vp-xs text-ink-2">{source.path}</p>
      {source.content && <><details><summary>{t('pm.contentDigest')}</summary><p className="my-2 break-all text-vp-xs">{source.digest}</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-vp-xs">{source.content}</pre></details><button type="button" className="vp-control mt-2" onClick={() => onDraft({ name: source.name, kind: source.kind, content: source.content || '' })}>{t('pm.importCapability')}</button></>}
    </article>)}</div>
  </details>
}

export function StageNotifications({ projectId, board }: { projectId: string; board: Board }) {
  useLang()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [enabled, setEnabled] = useState(false)
  const [peer, setPeer] = useState('')
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    const read = async () => {
      try {
        const [r, n, settings] = await Promise.all([request<Recipient[]>('/api/workflow/recipients'), request<Notice[]>(`/api/projects/${projectId}/notifications`), request<{ notificationsEnabled: boolean }>('/api/workflow/settings')])
        if (!cancelled) { setRecipients(r); setNotices(n); setEnabled(settings.notificationsEnabled) }
      } catch (e) { if (!cancelled) setError(String(e)) }
    }
    if (projectId) void read()
    const timer = window.setInterval(() => { if (projectId) void read() }, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [projectId])
  const send = async () => {
    const recipient = recipients.find((r) => `${r.channel}:${r.peerId}` === peer)
    if (!recipient || !stage || busy) return
    setBusy(true); setError('')
    try {
      const response = await appFetch(`/api/projects/${projectId}/stages/${stage}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: board.rev, channel: recipient.channel, peerId: recipient.peerId }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
      setNotices(await request<Notice[]>(`/api/projects/${projectId}/notifications`))
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="mt-5 rounded-vp-lg border border-hairline bg-surface p-4">
    <h2 className="font-semibold">{t('pm.remoteConfirmation')}</h2><p className="my-2 text-vp-base text-ink-2">{enabled ? t('pm.notificationsOn') : t('pm.notificationsOff')}</p>
    {enabled && <div className="grid gap-2 @2xl:grid-cols-3"><label>{t('pm.recipient')}<select className={field} value={peer} onChange={(e) => setPeer(e.target.value)}><option value="">{t('pm.chooseRecipient')}</option>{recipients.map((r) => <option key={`${r.channel}:${r.peerId}`} value={`${r.channel}:${r.peerId}`}>{r.name || r.peerId} · {r.channel}</option>)}</select></label><label>{t('pm.stageToConfirm')}<select className={field} value={stage} onChange={(e) => setStage(e.target.value)}><option value="">{t('pm.chooseStage')}</option>{board.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><button type="button" className="vp-control self-end" disabled={busy || !peer || !stage} onClick={() => void send()}>{t('pm.sendApproval')}</button></div>}
    {error && <p role="alert" className="mt-2">{error}</p>}
    {notices.map((n) => <p key={n.id} className="mt-2 break-words text-vp-base">{n.stageId} · {n.channel} · {n.state}{n.lastError && ` · ${n.lastError}`}</p>)}
  </section>
}

export function ProposalChanges({ current, proposed }: { current: Board | null; proposed: Board }) {
  useLang()
  if (!current) return null
  const changes: string[] = []
  if (current.goal !== proposed.goal) changes.push(t('pm.goalChanged'))
  for (const [label, before, after] of [[t('pm.stage'), current.stages, proposed.stages], [t('pm.task'), current.tasks, proposed.tasks]] as const) {
    for (const item of after) {
      const previous = before.find((old) => old.id === item.id)
      if (!previous) changes.push(t('pm.addedItem', { kind: label, title: item.title }))
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changes.push(t('pm.changedItem', { kind: label, title: item.title }))
    }
    for (const item of before) if (!after.some((next) => next.id === item.id)) changes.push(t('pm.removedItem', { kind: label, title: item.title }))
  }
  return <div className="my-2 text-vp-base"><p>{proposed.rev === current.rev ? t('pm.proposalCurrent') : t('pm.proposalStale')}</p><ul className="mt-2 list-inside list-disc">{changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>
}
