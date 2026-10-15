import { readdirSync, readFileSync, statSync } from 'node:fs'
import { KNOWN_LABELS } from './components/pages/labels'
import { CodedError, errorText, UnauthorizedError } from './protocol/api'
import { setLang } from './i18n'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Nothing user-visible may be an English literal in the source.
 *
 * Every gap found so far was found by eye, one file at a time: the whole
 * directory picker was hardcoded Chinese while `dir.cancel` sat unused in the
 * dictionary; the sign-in screen -- the first thing anybody sees -- was English
 * only; the mobile menu button, the empty-project line and eleven soft-key
 * tooltips were English on a Chinese page. None of it broke a test, because a
 * string that is simply the wrong language still renders.
 *
 * This is deliberately crude. It reads the sources as text and looks for the
 * two shapes a literal takes -- an attribute and a line of prose between tags --
 * rather than parsing TSX. A crude check that runs is worth more here than an
 * exact one that needs a parser dependency the project does not have.
 */
const SRC = new URL('./', import.meta.url).pathname

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (name.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** Comments are prose too, and they are not shipped. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// Words that are the same in both languages, or are not words at all.
const ALLOWED = new Set(['vibepanel', 'CPU', 'TLS', 'API', 'tmux', 'PWA'])

describe('every user-visible string comes from the dictionary', () => {
  const files = sources(SRC).filter((f) => !f.endsWith('.test.tsx'))

  it('finds the components at all', () => {
    // Without this the two tests below pass by scanning nothing, which is the
    // failure mode of every checker that walks a directory.
    expect(files.length).toBeGreaterThan(10)
  })

  it('has no English literal in a title, placeholder or aria-label', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'))
      for (const m of text.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) {
        const value = m[1]
        if (ALLOWED.has(value)) continue
        // A single lowercase token is a key name or a symbol, not a sentence.
        if (!/[A-Z]/.test(value) && !value.includes(' ')) continue
        bad.push(`${file.slice(SRC.length)}: ${JSON.stringify(value)}`)
      }
    }
    expect(bad, `use t('...') and add both languages to the dictionary:\n${bad.join('\n')}`)
      .toEqual([])
  })

  // The third shape, and the one the first two rules cannot see: a lookup table
  // of labels. Notes kept six of them -- 'saved', 'unsaved', 'changed
  // elsewhere' -- and the panel said them in English under a Chinese heading
  // for as long as the translation had existed. StateDot kept three more, which
  // are what a screen reader announces for the state indicator.
  //
  // Narrow on purpose: an object value that is a *phrase* -- it contains a
  // space or trails an ellipsis. `method: 'POST'` and `kind: 'output'` are not
  // phrases and do not trip it.
  it('has no English phrase as an object-literal value', () => {
    const bad: string[] = []
    for (const file of files) {
      if (file.endsWith('i18n.ts')) continue
      const text = stripComments(readFileSync(file, 'utf8'))
      for (const m of text.matchAll(/^\s*[A-Za-z_][A-Za-z0-9_]*:\s*'([A-Za-z][^']*(?: |…)[^']*)'/gm)) {
        bad.push(`${file.slice(SRC.length)}: ${JSON.stringify(m[1])}`)
      }
    }
    expect(bad, `use t('...') and add both languages to the dictionary:\n${bad.join('\n')}`)
      .toEqual([])
  })

  it('has no line of English prose sitting between tags', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'))
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        // Prose: three or more words, letters and ordinary punctuation only,
        // no JSX or code characters anywhere on the line.
        if (!/^[A-Za-z][A-Za-z ,.'’—-]{14,}$/.test(line)) continue
        if (line.split(/\s+/).length < 3) continue
        // An import alias -- `Settings as SettingsIcon,` -- is three words of
        // letters and a comma, and looks exactly like prose to the rule above.
        if (line.endsWith(',')) continue
        bad.push(`${file.slice(SRC.length)}: ${JSON.stringify(line)}`)
      }
    }
    expect(bad, `use t('...') and add both languages to the dictionary:\n${bad.join('\n')}`)
      .toEqual([])
  })
})

describe('the shapes the three rules above cannot see', () => {
  // A literal inside a conditional or a `??` is not an attribute value and not a
  // line of prose, so each of these passed every rule while being English on a
  // Chinese page: the sidebar's collapse tooltip, the rename tooltip, and the
  // selection bar a phone shows over the terminal.
  const src = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8'))

  it('the sidebar collapse button, the rename tooltip and the selection bar come from the dictionary', () => {
    expect(src('components/Sidebar.tsx')).not.toMatch(/title=\{[^}]*'(?:Close|Collapse)'/)
    expect(src('components/InlineName.tsx')).not.toMatch(/to rename/)
    const sel = src('components/mobile/SelectionCopy.tsx')
    expect(sel).not.toMatch(/character\{|selected\s*$|'Copy'|'Copied'/m)
    expect(sel).toMatch(/t\('sel\./)
  })

  it('has no ternary or ?? fallback that yields an English sentence in a title', () => {
    const bad: string[] = []
    for (const file of sources(SRC).filter((f) => !f.endsWith('.test.tsx'))) {
      for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/title=\{[^}]*?(?:\?\?|\?|:)\s*'([A-Z][A-Za-z ,.'-]+)'/g)) {
        bad.push(`${file.slice(SRC.length)}: ${JSON.stringify(m[1])}`)
      }
    }
    expect(bad, `use t('...'):\n${bad.join('\n')}`).toEqual([])
  })

  // The labels live in the templates' manifests, in English only. A template
  // that gains a label without a line in components/pages/labels.ts is the same
  // gap coming back.
  it('every label a built-in page template ships has a translation', () => {
    const dir = new URL('../../internal/pages/templates/', import.meta.url).pathname
    const seen = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'label' && typeof x === 'string') seen.add(x)
          else walk(x)
        }
      }
    }
    for (const name of readdirSync(dir)) {
      const p = join(dir, name, 'vibepanel.json')
      try {
        walk(JSON.parse(readFileSync(p, 'utf8')))
      } catch {
        /* a template directory without a manifest */
      }
    }
    expect(seen.size, 'read no template labels at all').toBeGreaterThan(8)
    expect([...seen].filter((l) => !KNOWN_LABELS.includes(l))).toEqual([])
  })

  it('a sign-in refusal is shown in the reader\'s language by its code', () => {
    setLang('zh')
    try {
      expect(errorText(new UnauthorizedError('wrong username or password', false, 'bad_credentials'))).toBe('用户名或密码不对')
      expect(errorText(new CodedError('too many attempts; try again in 3s', 'too_many_attempts', 3))).toContain('3')
      expect(errorText(new CodedError('too many attempts', 'too_many_attempts', 3))).not.toMatch(/[a-z]{4}/)
      // A code this build has no words for falls back to the sentence it was sent.
      expect(errorText(new CodedError('something new', 'a_code_from_a_newer_server'))).toBe('something new')
    } finally {
      setLang('en')
    }
  })
})
