import { t } from '../i18n'
import { askConfirm } from './ask'

export function confirmProjectAction(body: string, destructive = false): Promise<boolean> {
  return askConfirm({ title: t('pm.confirmTitle'), body, confirm: t('pm.confirm'), cancel: t('ask.cancel'), destructive })
}
