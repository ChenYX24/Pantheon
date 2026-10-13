import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Pinch zoom works.
 *
 * index.html said `maximum-scale=1.0, user-scalable=no`. iOS has ignored that
 * since iOS 10; Android honoured it, so somebody who needed the terminal's
 * text larger on a phone could not have it (WCAG 1.4.4). It was there against
 * two other things, each now handled where it belongs: iOS zooming into a
 * small focused field (every field is 16px under a coarse pointer, which
 * render-check measures) and a double-tap on a key read as zoom
 * (`touch-action: manipulation` on the root, which keeps pinch).
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('zoom', () => {
  const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? ''

  it('is not forbidden by the viewport', () => {
    expect(viewport).not.toBe('')
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/)
    expect(viewport).not.toMatch(/maximum-scale/)
  })

  it('keeps pinch and drops double-tap zoom on the root', () => {
    const root = /\nhtml \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(root).toMatch(/touch-action:\s*manipulation/)
  })
})
