import { describe, expect, it } from 'vitest'
import { fullscreenWheel } from './terminalWheel'

function setup() {
  const state = { fullscreen: true, mouseTracking: 'none', replaying: false }
  const sent: string[] = []
  const handle = fullscreenWheel(() => state, (data) => sent.push(data))
  const wheel = (values: Partial<WheelEvent> = {}) => {
    let claimed = false
    handle({ deltaX: 0, deltaY: -120, deltaMode: 0, timeStamp: 1000,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      preventDefault: () => { claimed = true }, stopImmediatePropagation: () => {},
      ...values } as WheelEvent)
    return claimed
  }
  return { state, sent, wheel }
}

describe('fullscreen wheel routing', () => {
  it('pages the transcript in both directions without synthesizing arrow/history keys', () => {
    const { sent, wheel } = setup()
    expect(wheel()).toBe(true)
    wheel({ deltaY: 120 })
    expect(sent).toEqual(['\x1b[5~', '\x1b[6~'])
  })
  it('leaves normal scrollback and mouse-reporting apps to xterm', () => {
    const { state, sent, wheel } = setup()
    state.fullscreen = false
    expect(wheel()).toBe(false)
    state.fullscreen = true
    state.mouseTracking = 'any'
    expect(wheel()).toBe(false)
    expect(sent).toEqual([])
  })
  it('preserves modified, horizontal and empty gestures', () => {
    const { sent, wheel } = setup()
    for (const values of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
      { shiftKey: true }, { deltaX: 150 }, { deltaY: 0 }, { deltaY: NaN }]) {
      expect(wheel(values)).toBe(false)
    }
    expect(sent).toEqual([])
  })
  it('accumulates small trackpad deltas and discards them when direction or gesture changes', () => {
    const { sent, wheel } = setup()
    wheel({ deltaY: -40 })
    wheel({ deltaY: -40, timeStamp: 1010 })
    expect(sent).toEqual([])
    wheel({ deltaY: -40, timeStamp: 1020 })
    expect(sent).toEqual(['\x1b[5~'])
    wheel({ deltaY: -80, timeStamp: 1030 })
    wheel({ deltaY: 40, timeStamp: 1040 })
    wheel({ deltaY: 80, timeStamp: 1500 })
    expect(sent).toHaveLength(1)
  })
  it('normalizes line and page deltas and bounds a large burst', () => {
    const { sent, wheel } = setup()
    wheel({ deltaY: -3, deltaMode: 1 })
    wheel({ deltaY: 1, deltaMode: 2 })
    wheel({ deltaY: -12000 })
    expect(sent).toEqual(['\x1b[5~', '\x1b[6~', '\x1b[5~'.repeat(3)])
  })
  it('blocks and forgets wheel input during replay; later input is not duplicated', () => {
    const { state, sent, wheel } = setup()
    wheel({ deltaY: -80 })
    state.replaying = true
    expect(wheel()).toBe(true)
    state.replaying = false
    wheel({ deltaY: -40 })
    expect(sent).toEqual([])
    wheel({ deltaY: -80 })
    expect(sent).toEqual(['\x1b[5~'])
  })
})
