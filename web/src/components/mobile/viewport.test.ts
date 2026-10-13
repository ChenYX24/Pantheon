import { describe, expect, it } from 'vitest'

import { keyBarFit } from './viewport'

/**
 * The keys give way before the terminal does.
 *
 * With the compose box and both rows of keys fixed at 105-153px, an iPhone SE
 * or a 320 Android in landscape with the keyboard up left the terminal 0px
 * tall. The heights below are the ones measured in that audit.
 */
describe('how much of the key bar fits', () => {
  it('keeps both rows on a portrait phone with the keyboard down', () => {
    expect(keyBarFit(844, 844)).toBe('full') // iPhone 13
    expect(keyBarFit(667, 667)).toBe('full') // iPhone SE
  })

  it('keeps one row once a keyboard is up on a tall phone', () => {
    // iOS: the layout stays 844 and the visible part shrinks.
    expect(keyBarFit(508, 844)).toBe('one')
  })

  it('keeps one row on a phone in landscape', () => {
    expect(keyBarFit(390, 390)).toBe('one')
    expect(keyBarFit(375, 375)).toBe('one')
  })

  it('drops the bar when what is visible is a sliver', () => {
    // An SE in landscape with its keyboard up.
    expect(keyBarFit(190, 375)).toBe('none')
    expect(keyBarFit(319, 319)).toBe('none')
  })

  it('does not take a few pixels of toolbar for a keyboard', () => {
    expect(keyBarFit(780, 844)).toBe('full')
  })
})
