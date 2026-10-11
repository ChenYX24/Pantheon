import { t } from '../../i18n'
import { homeApi, type HomeAutonomy, type HomePatchTask, type HomeTask, type HomeTaskStatus } from '../../protocol/home'
import { askConfirm, askText } from '../ask'
import { autonomyPatch, type HomeAutonomyDraft } from './execution'

export async function confirmHomeAutonomy(autonomy: HomeAutonomy | undefined, previous: HomeAutonomy): Promise<boolean> {
  return autonomy !== 'full' || previous === 'full' || askConfirm({
    title: t('home.exec.confirmFull'), body: t('home.exec.confirmFullBody'),
    confirm: t('home.confirm'), cancel: t('home.cancel'),
  })
}

export async function changeHomeAutonomy(projectId: string, draft: HomeAutonomyDraft): Promise<boolean> {
  const patch = autonomyPatch(draft)
  if (!patch || !await confirmHomeAutonomy(draft.autonomy, draft.originalAutonomy)) return false
  await homeApi.patchMeta(projectId, patch)
  return true
}

export function confirmHomeStatus(title: string, status: HomeTaskStatus): Promise<boolean> {
  return askConfirm({
    title: t('home.confirmStatus', { status: t(`home.status.${status}`) }),
    body: title,
    confirm: t('home.confirm'), cancel: t('home.cancel'), destructive: status === 'cancelled',
  })
}

export async function changeHomeTaskStatus(projectId: string, task: HomeTask, status: HomeTaskStatus): Promise<boolean> {
  if (status === task.status) return false
  return changeHomeTaskFields(projectId, task, { status })
}

export async function changeHomeTaskFields(projectId: string, task: HomeTask, fields: Omit<HomePatchTask, 'rev'>): Promise<boolean> {
  const status = fields.status
  if ((status === 'done' || status === 'cancelled') && !(await confirmHomeStatus(task.title, status))) return false
  let blockedReason = fields.blockedReason
  if (status === 'blocked' && task.status !== 'blocked' && blockedReason === undefined) {
    const reason = await askText({ title: t('home.blockedReason'), confirm: t('home.confirm'), cancel: t('home.cancel'), field: { label: t('home.blockedReason'), value: task.blockedReason } })
    if (reason === null) return false
    blockedReason = reason
  }
  // Use the revision the person saw, including time spent in the dialog.
  // Substituting a polled revision would silently overwrite a concurrent edit.
  await homeApi.patchTask(projectId, task.id, { ...fields, rev: task.rev, ...(blockedReason === undefined ? {} : { blockedReason }) })
  return true
}
