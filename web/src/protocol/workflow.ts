import { appFetch } from '../basePath'
import { t } from '../i18n'

/** Keep conflict responses intact so a rejected save never replaces a draft. */
export async function workflowRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await appFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    const reason = data.error || `HTTP ${response.status}`
    throw new Error(response.status === 409 ? t('pm.conflict', { reason }) : reason)
  }
  return data as T
}
