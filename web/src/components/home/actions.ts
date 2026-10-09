import { t } from '../../i18n'
import { homeApi, type HomeTask, type HomeTaskStatus } from '../../protocol/home'
import { askConfirm, askText } from '../ask'

export function confirmHomeStatus(title: string, status: HomeTaskStatus): Promise<boolean> {
  return askConfirm({
    title: t('home.confirmStatus', { status: t(`home.status.${status}`) }),
    body: title,
    confirm: t('home.confirm'), cancel: t('home.cancel'), destructive: status === 'cancelled',
  })
}

export async function changeHomeTaskStatus(projectId: string, task: HomeTask, status: HomeTaskStatus): Promise<boolean> {
  if (status === task.status) return false
  if ((status === 'done' || status === 'cancelled') && !(await confirmHomeStatus(task.title, status))) return false
  let blockedReason: string | undefined
  if (status === 'blocked') {
    const reason = await askText({ title: t('home.blockedReason'), confirm: t('home.confirm'), cancel: t('home.cancel'), field: { label: t('home.blockedReason'), value: task.blockedReason } })
    if (reason === null) return false
    blockedReason = reason
  }
  // Use the revision the person saw, including time spent in the dialog.
  // Substituting a polled revision would silently overwrite a concurrent edit.
  await homeApi.patchTask(projectId, task.id, { rev: task.rev, status, ...(blockedReason === undefined ? {} : { blockedReason }) })
  return true
}
