import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/(--vp-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]))
const shell = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')
const blueWeight = Number(shell.match(/--home-link: color-mix\(in srgb, var\(--vp-term-blue\) (\d+)%, var\(--vp-ink\)\)/)![1]) / 100
const light = tokens(css.match(/:root \{([\s\S]*?)\n\}/)![1])
const dark = { ...light, ...tokens(css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1]) }

function rgb(value: string): number[] {
  if (value.startsWith('#')) return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16))
  return value.match(/[\d.]+/g)!.map(Number)
}
function luminance(color: number[]): number {
  const linear = color.map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4 })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

describe('home text contrast', () => {
  for (const [theme, palette] of Object.entries({ light, dark })) {
    for (const surface of ['--vp-bg', '--vp-surface', '--vp-surface-2']) {
      it(`meets AA for body, metadata and links on ${theme} ${surface}`, () => {
        const background = rgb(palette[surface])
        for (const ink of ['--vp-ink', '--vp-ink-2', '--home-link']) {
          const foreground = ink === '--home-link' ? rgb(palette['--vp-term-blue']).map((channel, index) => channel * blueWeight + rgb(palette['--vp-ink'])[index] * (1 - blueWeight)) : rgb(palette[ink])
          const alpha = foreground[3] ?? 1
          const text = foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha))
          const lumas = [luminance(text), luminance(background)].sort((a, b) => a - b)
          expect((lumas[1] + 0.05) / (lumas[0] + 0.05), ink).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})
