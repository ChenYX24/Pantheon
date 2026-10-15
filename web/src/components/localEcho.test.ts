import { describe, expect, it } from 'vitest'
import { LocalEcho } from './localEcho'
import type { EchoState, EchoTerminal, LocalEchoMode } from './localEcho'

function fixture(rtt = 300, mode: LocalEchoMode = 'auto') {
  const cells = new Map<string, { char: string; width: number }>()
  const term: EchoTerminal = {
    cols: 80,
    buffer: { active: {
      type: 'normal', baseY: 10, viewportY: 10, cursorX: 2, cursorY: 3,
      getLine: (row) => ({ getCell: (col) => ({
        getChars: () => cells.get(`${row}:${col}`)?.char ?? '',
        getWidth: () => cells.get(`${row}:${col}`)?.width ?? 1,
      }) }),
    } },
  }
  const state: EchoState = {
    controlling: true, readOnly: false, replaying: false, fullscreen: false, composing: false, hidden: false,
  }
  const engine = new LocalEcho()
  let now = 0
  const input = (text: string) => engine.input(text, term, state, now, rtt, mode)
  const parsed = () => engine.parsed(term, state, now, rtt)
  const visible = () => engine.visible(now, rtt, mode).map((p) => p.char).join('')
  const put = (col: number, char: string, width = 1) => cells.set(`13:${col}`, { char, width })
  const echo = (text: string) => {
    for (const char of text) put(term.buffer.active.cursorX++, char)
    parsed()
  }
  const learn = () => { input('a'); echo('a') }
  return { engine, term, state, input, parsed, visible, put, echo, learn, advance: (ms: number) => { now += ms } }
}

describe('local echo without terminal writes', () => {
  it('starts silently, confirms in order, and leaves the authoritative cells alone', () => {
    const f = fixture()
    f.input('a')
    expect(f.visible()).toBe('')
    expect(f.engine.pending[0]).toMatchObject({ row: 13, col: 2, char: 'a', display: false })
    expect(f.term.buffer.active.getLine(13)?.getCell(2)?.getChars()).toBe('')
    f.echo('a')
    expect(f.engine.pending).toEqual([])
    f.input('b')
    f.input('c')
    expect(f.visible()).toBe('bc')
    f.echo('b')
    expect(f.visible()).toBe('c')
    f.echo('c')
    expect(f.engine.pending).toEqual([])
    expect(f.term.buffer.active.cursorX).toBe(5)
  })

  it('confirms a batch and never reveals characters that were typed silently', () => {
    const f = fixture()
    f.input('a')
    f.input('b')
    f.echo('a')
    expect(f.visible()).toBe('')
    f.input('c')
    expect(f.visible()).toBe('c')
    f.echo('bc')
    expect(f.engine.pending).toEqual([])
  })

  it.each(['\x7f', '\b'])('retracts the last unconfirmed character for backspace %j', (key) => {
    const f = fixture()
    f.learn()
    f.input('b')
    f.input('c')
    f.input(key)
    expect(f.visible()).toBe('b')
    expect(f.engine.pending).toHaveLength(1)
    f.input(key)
    expect(f.visible()).toBe('')
    expect(f.term.buffer.active.cursorX).toBe(3)
  })

  it.each(['\r', '\n', '\t', '\x1b', '\x1b[D', '\x03', 'paste', 'ab', ''])('clears predictions and confidence on %j', (key) => {
    const f = fixture()
    f.learn()
    f.input('b')
    f.input(key)
    expect(f.engine.pending).toEqual([])
    f.input('s')
    expect(f.visible()).toBe('')
  })

  it('drops all predictions on a mismatch and relearns only from a silent confirmation', () => {
    const f = fixture()
    f.learn()
    f.input('b')
    f.input('c')
    f.echo('X')
    expect(f.engine.pending).toEqual([])
    f.input('s')
    f.input('e')
    expect(f.visible()).toBe('')
    f.echo('s')
    expect(f.visible()).toBe('')
    f.input('f')
    expect(f.visible()).toBe('f')
    f.echo('ef')
    expect(f.engine.pending).toEqual([])
  })

  it.each(['auto', 'on'] as const)('never displays non-echoing input after a glitch in %s mode', (mode) => {
    const f = fixture(300, mode)
    f.learn()
    f.input('b')
    f.echo('X')
    f.input('s')
    expect(f.visible()).toBe('')
    f.input('e')
    expect(f.visible()).toBe('')
    f.advance(1_500)
    expect(f.visible()).toBe('')
    f.input('c')
    expect(f.visible()).toBe('')
  })

  it('catches a conflicting redraw in a later cell while the first echo is still outstanding', () => {
    const f = fixture()
    f.learn()
    f.input('b')
    f.input('c')
    f.put(4, 'X')
    f.parsed()
    expect(f.visible()).toBe('')
    expect(f.engine.pending).toEqual([])
  })

  it.each(['row', 'back', 'forward', 'scrollback'])('drops predictions if the cursor or viewport moves away: %s', (move) => {
    const f = fixture()
    f.learn()
    f.input('b')
    const buffer = f.term.buffer.active
    if (move === 'row') buffer.cursorY++
    if (move === 'back') buffer.cursorX--
    if (move === 'forward') buffer.cursorX++
    if (move === 'scrollback') buffer.viewportY--
    f.parsed()
    expect(f.engine.pending).toEqual([])
  })

  it('does not carry confidence into a prompt printed after an echo', () => {
    const f = fixture()
    f.input('a')
    f.put(2, 'a')
    f.term.buffer.active.cursorX = 15
    f.parsed()
    f.input('s')
    expect(f.visible()).toBe('')
  })

  it('revokes confidence when unsolicited output arrives, even on the same row', () => {
    const f = fixture()
    f.learn()
    f.parsed()
    f.input('s')
    f.input('e')
    expect(f.visible()).toBe('')
    f.advance(1_500)
    expect(f.visible()).toBe('')
    expect(f.engine.pending).toEqual([])
  })

  it.each([300, 600])('times out at max(1500ms, 4 × RTT) for %ims RTT and relearns silently', (rtt) => {
    const f = fixture(rtt)
    f.learn()
    f.input('b')
    const timeout = Math.max(1_500, 4 * rtt)
    expect(f.engine.deadline(rtt)).toBe(timeout)
    f.advance(timeout - 1)
    expect(f.visible()).toBe('b')
    f.advance(1)
    expect(f.visible()).toBe('')
    expect(f.engine.pending).toEqual([])
    f.input('s')
    f.input('e')
    expect(f.visible()).toBe('')
  })

  it.each(['controlling', 'readOnly', 'replaying', 'fullscreen', 'composing', 'hidden'] as const)('does not predict when %s disallows it', (flag) => {
    const f = fixture()
    f.learn()
    f.input('b')
    f.state[flag] = flag !== 'controlling'
    f.input('c')
    expect(f.engine.pending).toEqual([])
  })

  it('does not predict in xterm alternate buffers or while looking at scrollback', () => {
    const f = fixture()
    f.term.buffer.active.type = 'alternate'
    f.input('a')
    expect(f.engine.pending).toEqual([])
    f.term.buffer.active.type = 'normal'
    f.term.buffer.active.viewportY--
    f.input('b')
    expect(f.engine.pending).toEqual([])
  })

  it.each(['中', '！', '🙂', 'é', '\u0301'])('sends non-ASCII %s without prediction or width guesses', (text) => {
    const f = fixture()
    f.learn()
    f.input(text)
    expect(f.engine.pending).toEqual([])
  })

  it('skips existing text, wide cells and the wrap column', () => {
    const f = fixture()
    f.put(2, 'a')
    f.input('a')
    expect(f.engine.pending).toEqual([])
    f.put(2, '', 0)
    f.input('a')
    expect(f.engine.pending).toEqual([])
    f.term.buffer.active.cursorX = 79
    f.input('a')
    expect(f.engine.pending).toEqual([])
  })

  it('does not mistake a pre-existing blank for a space being echoed', () => {
    const f = fixture()
    f.input(' ')
    f.parsed()
    expect(f.engine.pending).toHaveLength(1)
    f.input('s')
    expect(f.visible()).toBe('')
    f.echo(' ')
    expect(f.engine.pending.map((p) => p.char)).toEqual(['s'])
  })

  it.each([null, 30, 60, 61, 183])('uses the smoothed RTT threshold: %s', (rtt) => {
    const f = fixture(rtt ?? 0)
    f.learn()
    f.engine.input('b', f.term, f.state, 0, rtt, 'auto')
    expect(f.engine.visible(0, rtt, 'auto').length).toBe(rtt !== null && rtt > 60 ? 1 : 0)
  })

  it('Always on removes only the RTT gate, and Always off stops silent tracking too', () => {
    const f = fixture(0, 'on')
    f.input('a')
    expect(f.visible()).toBe('')
    f.echo('a')
    f.input('b')
    expect(f.visible()).toBe('b')
    f.engine.input('c', f.term, f.state, 0, 300, 'off')
    expect(f.engine.pending).toEqual([])
  })

  it('requires recent evidence, not a character echoed minutes ago', () => {
    const f = fixture()
    f.learn()
    f.advance(5_000)
    f.input('s')
    expect(f.visible()).toBe('')
  })

  it('expires a displayed character when its evidence becomes stale, even on a very slow link', () => {
    const f = fixture(2_000)
    f.learn()
    f.advance(4_900)
    f.input('b')
    expect(f.visible()).toBe('b')
    expect(f.engine.deadline(2_000)).toBe(5_000)
    f.advance(100)
    expect(f.visible()).toBe('')
    expect(f.engine.pending).toEqual([])
  })
})
