import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Inside a dialog a responsive variant is a container query, never `sm:`/`lg:`.
 *
 * The settings dialog is at most 48rem wide and usually less, so a viewport
 * breakpoint fires for the window and not for the box the rail actually sits
 * in; the sharing editor was laid out wrong on every desktop from that one
 * mistake. AGENTS.md states the rule and Sharing/PageLinks follow it; this is
 * the part that fails when a file does not.
 */
const here = new URL('./components/', import.meta.url)
const files = [
  'Settings.tsx',
  ...readdirSync(new URL('settings/', here)).filter((f) => f.endsWith('.tsx')).map((f) => `settings/${f}`),
]

// `sm:flex-row`, `lg:w-40`, `max-md:hidden` -- a viewport variant at the start
// of a class. `@xl:` and `@max-xl:` are the container ones and do not match.
const viewportVariant = /(?:^|[\s"'`{])(?:max-)?(?:sm|md|lg|xl|2xl):[\w[]/

describe('dialog components use container queries', () => {
  it('has files to look at', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  for (const f of files) {
    it(`${f} has no viewport breakpoints`, () => {
      const lines = readFileSync(new URL(f, here), 'utf8').split('\n')
      const hits = lines
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && viewportVariant.test(l))
        .map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`)
      expect(hits, `${f} uses a window breakpoint inside the settings dialog`).toEqual([])
    })
  }

  it('the dialog is a container', () => {
    const src = readFileSync(new URL('Settings.tsx', here), 'utf8')
    expect(src).toMatch(/data-vp-modal="settings"[\s\S]*?@container/)
  })
})
