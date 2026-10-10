import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeApi, type HomeTask } from '../../protocol/home'
import { answerAsk, currentAsk } from '../ask'
import { changeHomeTaskFields, changeHomeTaskStatus } from './actions'

const task: HomeTask = {
  priority: '', tags: [], owner: '', due: '', id: 'A2', title: 'Review the backend', status: 'awaiting_review', stage: 'A', primary: '', secondary: '',
  dependsOn: [], session: '', blockedReason: '', sessionStatus: 'ok', updated: '', handoffs: 0, body: '', rev: 'visible-revision', file: 'task.md',
}
afterEach(() => {
  while (currentAsk()) answerAsk(null)
  vi.restoreAllMocks()
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
