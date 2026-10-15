import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isEnter } from './enter'

describe('isEnter', () => {
  it('is a plain Enter', () => {
    expect(isEnter({ key: 'Enter' })).toBe(true)
    expect(isEnter({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(true)
  })

  it('is not the Enter that picks an input-method candidate', () => {
    expect(isEnter({ key: 'Enter', nativeEvent: { isComposing: true, keyCode: 13 } })).toBe(false)
    expect(isEnter({ key: 'Enter', isComposing: true })).toBe(false)
  })

  it('is not the keyCode 229 a dictation keyboard sends without isComposing', () => {
    expect(isEnter({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(false)
  })

  it('is not another key', () => {
    expect(isEnter({ key: 'Escape' })).toBe(false)
  })
})

/**
 * Every Enter goes through isEnter.
 *
 * Seven handlers read `key === 'Enter'` alone and committed a half-typed
 * name when an input method's Enter picked a candidate; three others had the
 * guard, each written by hand. The next form arrives as one more line in a
 * component nobody is reviewing for this, so it is a rule over the source.
 */
const SRC = new URL('../', import.meta.url).pathname

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('Enter handlers', () => {
  it('all read Enter through isEnter', () => {
    // Event objects only: dirpicker's resolveKey takes a key name in a plain
    // record, and its caller drops composing keys before it is asked.
    const bare = /\b(e|ev|event)\.key\s*===\s*['"]Enter['"]/
    const offenders = sources(SRC)
      .filter((p) => !p.endsWith('/components/enter.ts'))
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => [p.slice(SRC.length) + ':' + (i + 1), line] as const)
          .filter(([, line]) => bare.test(line))
          .map(([where]) => where),
      )
    expect(offenders, 'use isEnter(e) so an input method can choose a candidate').toEqual([])
  })
})
