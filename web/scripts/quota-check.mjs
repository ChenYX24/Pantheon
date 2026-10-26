// Subscription limits, the handoff settings, and a page older than its panel,
// in a real browser against a real binary.
//
//   node scripts/quota-check.mjs [binary] [shots-dir]
//
// The limits travel further than anything a unit test covers: Claude Code
// pipes a document to the panel's reporter as its status line, the reporter
// throttles and posts it in the background, the hook endpoint checks it and
// files it under the session's account, and the snapshot carries it to a chip
// in the session header. This sends a real document through the real
// reporter, from inside a real session, and reads the chip.
//
// The update notice exists because a tab opened before an upgrade kept the old
// interface with nothing on screen to say so. To show one here the page is
// served an index.html that names an older entry script first, which is what
// such a tab's document says; served unchanged, there must be no notice.
//
// The handoff section is the two triggers, context and memory, together, and
// measured to fit the settings dialog at three widths in both themes.
import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertFreshBuild } from './lib/fresh.mjs'
import { sweepStaleSockets } from './lib/stale.mjs'

const BIN = process.argv[2] ?? new URL('../../vibepanel', import.meta.url).pathname
assertFreshBuild(BIN, new URL('../../', import.meta.url).pathname)
sweepStaleSockets((msg) => console.log(`==> ${msg}`))
const SHOTS = process.argv[3] ?? join(tmpdir(), 'vpquota-shots')
mkdirSync(SHOTS, { recursive: true })

const PORT = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const SOCKET = `vpquota-${process.pid}`
const DATA = mkdtempSync(join(tmpdir(), 'vpquota-'))
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'vpquota-home-'))
const BASE = `http://127.0.0.1:${PORT}`
const USERNAME = 'limits'
const PASSWORD = 'a sufficiently long password'

const findings = []
const pageErrors = []
const note = (sev, area, msg) => findings.push({ sev, area, msg })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await sleep(150)
  }
  return false
}

let serverLog = ''
const server = spawn(BIN, ['serve', '--addr', `127.0.0.1:${PORT}`], {
  env: {
    ...process.env,
    HOME: FAKE_HOME,
    VIBEPANEL_DATA_DIR: join(DATA, 'data'),
    VIBEPANEL_TMUX_SOCKET: SOCKET,
    // The reporter's throttle stamp lands here, not in the real runtime dir.
    XDG_RUNTIME_DIR: DATA,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

let browser
let cleanedUp = false
async function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  try { await browser?.close() } catch { /* already gone */ }
  server.kill('SIGTERM')
  await sleep(500)
  try { execSync(`tmux -L ${SOCKET} kill-server`, { stdio: 'ignore' }) } catch { /* none */ }
  try { rmSync(DATA, { recursive: true, force: true }) } catch { /* best effort */ }
  try { rmSync(FAKE_HOME, { recursive: true, force: true }) } catch { /* best effort */ }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => void cleanup().finally(() => process.exit(130)))
}

let cookie = ''
async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  })
  if (res.status >= 400) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res
}
const json = async (path, init) => (await api(path, init)).json()

async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="login-form"]').waitFor({ timeout: 10000 })
  await page.locator('[data-testid="auth-username"]').fill(USERNAME)
  await page.locator('[data-testid="auth-password"]').fill(PASSWORD)
  await page.locator('[data-testid="auth-submit"]').click()
  await page.locator('[data-testid="project-group"]').first().waitFor({ timeout: 10000 })
}

/** Nothing inside `sel` may reach past the viewport's right edge. */
async function fitsWidth(page, sel, area) {
  const over = await page.evaluate((s) => {
    const root = document.querySelector(s)
    if (!root) return ['(missing)']
    const w = document.documentElement.clientWidth
    const out = []
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > w + 1) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? ''}] right=${Math.round(r.right)} > ${w}`)
    }
    return out.slice(0, 5)
  }, sel)
  if (over.length > 0) note('FAIL', area, `${sel} does not fit the screen: ${over.join('; ')}`)
}

// What Claude Code 2.1.310 piped to its status line on a Max login, trimmed.
const STATUS = JSON.stringify({
  session_id: 'check',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  rate_limits: {
    five_hour: { used_percentage: 12, resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 },
    seven_day: { used_percentage: 83, resets_at: Math.floor(Date.now() / 1000) + 4 * 86400 },
  },
})

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break } catch { /* not up */ }
    await sleep(150)
  }
  const token = /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(serverLog)?.[1]
  if (!token) throw new Error(`no setup token in the server output:\n${serverLog}`)
  const setup = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ token, username: USERNAME, password: PASSWORD }) })
  cookie = (setup.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  await api('/api/settings/tour', { method: 'POST' })

  const script = join(DATA, 'data', 'hooks', 'vibepanel-report.sh')
  if (!(await until(async () => existsSync(script), 5000))) throw new Error(`the panel did not write ${script}`)
  const dir = mkdtempSync(join(DATA, 'work-'))
  const project = await json('/api/projects', { method: 'POST', body: JSON.stringify({ path: dir, name: 'limits' }) })
  // The reporter run as Claude Code runs a status line: the document on
  // stdin, the session's own environment, twice in a row. The second must be
  // throttled, which the server cannot see; what it can see is one reading.
  const sess = await json('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.id,
      title: 'status line',
      command: ['sh', '-c', 'printf "%s" "$1" | "$2" quota; printf "%s" "$1" | "$2" quota; exec sleep 600', 'sh', STATUS, script],
    }),
  })
  const arrived = await until(async () => (await json('/api/state')).quota?.[sess.id]?.limits?.length === 2)
  if (!arrived) note('FAIL', 'report', `the status line's limits never reached the snapshot: ${JSON.stringify((await json('/api/state')).quota)}`)

  browser = await chromium.launch({ headless: true })
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width: 1280, height: 860 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await signIn(page)
    await page.locator('[data-testid="session-row"]').filter({ hasText: 'status line' }).first().click()

    const chip = page.locator('[data-testid="quota-meter"]')
    if (!(await until(() => chip.isVisible()))) {
      note('FAIL', `header-${scheme}`, 'no limits chip beside the context meter')
    } else {
      const text = (await chip.innerText()).trim()
      if (!text.includes('5h 12%') || !text.includes('7d 83%')) note('FAIL', `header-${scheme}`, `the chip reads ${JSON.stringify(text)}`)
      const label = (await chip.getAttribute('aria-label')) ?? ''
      if (!/Claude/.test(label)) note('FAIL', `header-${scheme}`, `the chip does not say whose limits: ${label}`)
      // 83% is past the warning step, and says so in colour as well as text.
      const cls = (await chip.getAttribute('class')) ?? ''
      if (!cls.includes('text-state-waiting')) note('FAIL', `header-${scheme}`, `83% is not drawn as a warning: ${cls}`)
      await chip.locator('xpath=..').screenshot({ path: join(SHOTS, `header-${scheme}.png`) }).catch(() => {})
    }
    if (await page.locator('[data-testid="update-notice"]').count()) note('FAIL', `notice-${scheme}`, 'an up-to-date page says the panel was updated')

    for (const width of [1280, 820, 390]) {
      await page.setViewportSize({ width, height: 860 })
      await sleep(300)
      if (!(await page.locator('[data-testid="settings-open"]').isVisible().catch(() => false))) {
        await page.locator('[data-testid="drawer-toggle"], [data-testid="sidebar-toggle"]').first().click().catch(() => {})
      }
      await page.locator('[data-testid="settings-open"]').first().click()
      await page.getByTestId('settings-group-resources').click()
      const section = page.locator('[data-section="autorollover"]')
      if (!(await until(() => section.isVisible()))) {
        note('FAIL', `settings-${scheme}-${width}`, 'no handoff section on the resources page')
      } else {
        for (const id of ['handoff-by-context', 'handoff-by-memory']) {
          if ((await section.locator(`[data-testid="${id}"]`).count()) !== 1) note('FAIL', `settings-${scheme}-${width}`, `${id} is not in the handoff section`)
        }
        if ((await page.locator('[data-section="allocation"] [data-testid="resources-rollover"]').count()) !== 0) {
          note('FAIL', `settings-${scheme}-${width}`, 'the memory trigger is still inside the allocation section')
        }
        if (!(await section.locator('[data-testid="auto-rollover-policy"]').isVisible().catch(() => false))) {
          note('FAIL', `settings-${scheme}-${width}`, 'the context trigger did not load')
        }
        await fitsWidth(page, '[data-section="autorollover"]', `settings-${scheme}-${width}`)
        await section.screenshot({ path: join(SHOTS, `handoff-${scheme}-${width}.png`) }).catch(() => {})
      }
      await page.keyboard.press('Escape')
      await sleep(200)
    }
    await ctx.close()
  }

  // A tab from before an upgrade: its document names the entry script it was
  // built with, and the server is now serving another.
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 860 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await page.route('**/*', async (route) => {
      const req = route.request()
      if (req.url().endsWith('/assets/index-0ldBu1ld.js')) return route.fulfill({ contentType: 'text/javascript', body: '' })
      if (req.resourceType() !== 'document') return route.continue()
      const res = await route.fetch()
      const body = (await res.text()).replace('<head>', '<head><script type="module" src="/assets/index-0ldBu1ld.js"></script>')
      return route.fulfill({ response: res, body })
    })
    await signIn(page)
    const notice = page.locator('[data-testid="update-notice"]')
    if (!(await until(() => notice.isVisible()))) {
      note('FAIL', 'notice', 'a page older than its panel says nothing')
    } else {
      if (!(await notice.locator('[data-testid="update-reload"]').isVisible())) note('FAIL', 'notice', 'the notice has no way to reload')
      await notice.screenshot({ path: join(SHOTS, 'notice.png') }).catch(() => {})
      await page.unroute('**/*')
      await notice.locator('[data-testid="update-reload"]').click()
      await page.locator('[data-testid="project-group"]').first().waitFor({ timeout: 10000 })
      await sleep(800)
      if (await notice.count()) note('FAIL', 'notice', 'the notice outlived the reload into the current build')
    }
    await ctx.close()
  }
} catch (err) {
  note('FAIL', 'harness', String(err?.stack ?? err))
} finally {
  for (const e of [...new Set(pageErrors)]) note('FAIL', 'js', `uncaught: ${e}`)
  await cleanup()
}

const fails = findings.filter((f) => f.sev === 'FAIL').length
console.log(`\n=== quota check: ${fails} FAIL, ${findings.filter((f) => f.sev === 'WARN').length} WARN ===`)
for (const f of findings) console.log(`[${f.sev}] ${f.area}: ${f.msg}`)
console.log(`shots: ${SHOTS}`)
process.exit(fails > 0 ? 1 : 0)
