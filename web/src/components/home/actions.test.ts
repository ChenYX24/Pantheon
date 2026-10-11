import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeApi, type HomeTask } from '../../protocol/home'
import { answerAsk, currentAsk } from '../ask'
import { changeHomeAutonomy, changeHomeTaskFields, changeHomeTaskStatus } from './actions'
import { autonomyDraft } from './execution'

const task: HomeTask = {
  priority: '', tags: [], owner: '', due: '', id: 'A2', title: 'Review the backend', status: 'awaiting_review', stage: 'A', primary: '', secondary: '',
  dependsOn: [], session: '', blockedReason: '', sessionStatus: 'ok', updated: '', handoffs: 0, body: '', rev: 'visible-revision', file: 'task.md',
}
afterEach(() => {
  while (currentAsk()) answerAsk(null)
  vi.restoreAllMocks()
})

describe('full autonomy consent', () => {
  it('uses the shared confirmation before writing, and cancellation leaves metadata alone', async () => {
    const patch = vi.spyOn(homeApi, 'patchMeta').mockResolvedValue({})
    const draft = { ...autonomyDraft({}, 'seen-rev'), autonomy: 'full' as const }
    const cancelled = changeHomeAutonomy('pantheon', draft)
    expect(currentAsk()).not.toBeNull()
    expect(patch).not.toHaveBeenCalled()
    answerAsk(null)
    expect(await cancelled).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    const accepted = changeHomeAutonomy('pantheon', draft)
    answerAsk('')
    expect(await accepted).toBe(true)
    expect(patch).toHaveBeenCalledExactlyOnceWith('pantheon', { rev: 'seen-rev', autonomy: 'full', approvedStages: [], autoMerge: false, maxAttempts: 2, attemptMinutes: 30 })
  })

  it('does not ask again for an existing full-auto project and refuses invalid limits', async () => {
    const patch = vi.spyOn(homeApi, 'patchMeta').mockResolvedValue({})
    const draft = autonomyDraft({ autonomy: 'full' }, 'seen')
    expect(await changeHomeAutonomy('pantheon', draft)).toBe(true)
    expect(currentAsk()).toBeNull()
    expect(await changeHomeAutonomy('pantheon', { ...draft, maxAttempts: '4' })).toBe(false)
    expect(patch).toHaveBeenCalledTimes(1)
  })
})

describe('explicit task status changes', () => {
  it.each(['done', 'cancelled'] as const)('does not write %s until the person confirms', async (status) => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockResolvedValue({ ...task, status })
    const pending = changeHomeTaskStatus('pantheon', task, status)
    expect(patch).not.toHaveBeenCalled()
    expect(currentAsk()?.request.destructive).toBe(status === 'cancelled')
    answerAsk(null)
    expect(await pending).toBe(false)
    expect(patch).not.toHaveBeenCalled()
  })

  it('submits the displayed revision after confirmation', async () => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockResolvedValue({ ...task, status: 'done', rev: 'next' })
    const pending = changeHomeTaskStatus('pantheon', task, 'done')
    answerAsk('')
    expect(await pending).toBe(true)
    expect(patch).toHaveBeenCalledExactlyOnceWith('pantheon', 'A2', { rev: 'visible-revision', status: 'done' })
  })

  it('keeps cancelling a blocker distinct from an intentionally empty reason', async () => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockResolvedValue({ ...task, status: 'blocked' })
    const cancelled = changeHomeTaskStatus('pantheon', task, 'blocked')
    answerAsk(null)
    expect(await cancelled).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    const empty = changeHomeTaskStatus('pantheon', task, 'blocked')
    answerAsk('')
    expect(await empty).toBe(true)
    expect(patch).toHaveBeenCalledExactlyOnceWith('pantheon', 'A2', { rev: 'visible-revision', status: 'blocked', blockedReason: '' })
  })

  it('does nothing for the current status and propagates a failed write without retrying', async () => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockRejectedValue(new Error('stale'))
    expect(await changeHomeTaskStatus('pantheon', task, task.status)).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    await expect(changeHomeTaskStatus('pantheon', task, 'in_progress')).rejects.toThrow('stale')
    expect(patch).toHaveBeenCalledTimes(1)
  })
})


describe('task field suggestions', () => {
  it('confirms terminal status even when it is one of several suggested fields', async () => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockResolvedValue({ ...task, status: 'done' })
    const cancelled = changeHomeTaskFields('pantheon', task, { status: 'done', priority: 'P0', tags: ['review'] })
    answerAsk(null)
    expect(await cancelled).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    const accepted = changeHomeTaskFields('pantheon', task, { status: 'done', priority: 'P0', tags: ['review'] })
    answerAsk('')
    expect(await accepted).toBe(true)
    expect(patch).toHaveBeenCalledExactlyOnceWith('pantheon', 'A2', { rev: 'visible-revision', status: 'done', priority: 'P0', tags: ['review'] })
  })
  it('does not discard explicit blocker text when applying a multi-field suggestion', async () => {
    const patch = vi.spyOn(homeApi, 'patchTask').mockResolvedValue({ ...task, status: 'blocked' })
    expect(await changeHomeTaskFields('pantheon', task, { status: 'blocked', blockedReason: 'Needs review', owner: 'cyx' })).toBe(true)
    expect(currentAsk()).toBeNull()
    expect(patch).toHaveBeenCalledWith('pantheon', 'A2', { rev: 'visible-revision', status: 'blocked', blockedReason: 'Needs review', owner: 'cyx' })
  })
})
