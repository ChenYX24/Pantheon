import { afterEach, describe, expect, it, vi } from 'vitest'
import { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { echoCellSize } from './localEchoOverlay'

afterEach(() => vi.unstubAllGlobals())

describe('prediction geometry', () => {
  it('uses the installed FitAddon cell metrics, including fractional widths', () => {
    const element = { parentElement: {} }
    vi.stubGlobal('window', { getComputedStyle: (target: unknown) => ({
      getPropertyValue: (name: string) => target === element ? '0px' : name === 'width' ? '800px' : '300px',
    }) })
    const term = { element, options: { scrollback: 0 },
      _core: { _renderService: { dimensions: { css: { cell: { width: 7.8125, height: 15 } } } } },
    }
    const fit = new FitAddon()
    fit.activate(term as unknown as Terminal)
    const cell = echoCellSize(term)!
    expect(fit.proposeDimensions()).toEqual({ cols: Math.floor(800 / cell.width), rows: 300 / cell.height })
  })

  it.each([null, {}, { _core: {} }, { _core: { _renderService: { dimensions: { css: { cell: { width: 0, height: 15 } } } } } }])(
    'disables drawing when metrics are unavailable: %j', (term) => {
      expect(echoCellSize(term)).toBeNull()
    },
  )
})
