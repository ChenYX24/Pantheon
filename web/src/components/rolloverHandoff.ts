import type { AutoRollover } from '../protocol/wire'
import { api } from '../protocol/api'
import { showToast } from './toasts'

export interface HandoffPair { oldId: string; newId: string }

// Remember unseen pairs even when another session is selected. Returning to
// an old session later must not pull the person away from it a second time.
export function selectedHandoff(seen: Set<string>, views: Record<string, AutoRollover>, selected: string | null): HandoffPair | null {
  let pair: HandoffPair | null = null
  for (const [oldId, view] of Object.entries(views)) {
    if (view.state !== 'handed_off' || !view.newSessionId) continue
    const key = `${oldId}:${view.newSessionId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (oldId === selected) pair = { oldId, newId: view.newSessionId }
  }
  return pair
}

export function handoffInputFocused(element: Element | null): boolean {
  return !!element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
}

export function announceHandoff(pair: HandoffPair, select: (id: string) => void, inputFocused: boolean) {
  if (!inputFocused) select(pair.newId)
  return showToast({
    kind: 'success', key: 'autoRollover.toast',
    actions: [
      { key: 'autoRollover.back', run: async () => { select(pair.oldId); await api.autoRollover(pair.oldId, 'keep') } },
      { key: 'autoRollover.releaseToast', run: () => api.autoRollover(pair.oldId, 'release') },
    ],
  })
}
