// Archiving a project, in a browser.
//
//   npm run build && (cd .. && go build -o vibepanel ./cmd/vibepanel)
//   npm run check:archive
//
// What the Go tests cannot see: that the control is on the project row and
// works, that the line under the last project appears and leads somewhere,
// that the picker offers an archived project and choosing it brings the old
// one back rather than a second one, that the setting sticks -- and that all
// of it fits a phone and both themes. Plus the one fact the whole feature
// rests on, asked of tmux itself rather than of the panel: the session in an
// archived project is still running.
import { chromium } from 'playwright'
import { spawn, execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertFreshBuild } from './lib/fresh.mjs'
import { sweepStaleSockets } from './lib/stale.mjs'
const BIN = process.argv[2] ?? new URL('../../vibepanel', import.meta.url).pathname
assertFreshBuild(BIN, new URL('../../', import.meta.url).pathname)
sweepStaleSockets((msg) => console.log(`==> ${msg}`))
const SHOTS = process.argv[3] ?? join(tmpdir(), 'vparchive-shots')
mkdirSync(SHOTS, { recursive: true })

const PORT = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const SOCKET = `vparchive-${process.pid}`
const DATA = mkdtempSync(join(tmpdir(), 'vparchive-'))
// A home of its own: signing in runs nothing that writes agent config today,
// and a check that is one refactor away from editing somebody's
// ~/.claude/settings.json should not be relying on that.
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'vparchive-home-'))
const BASE = `http://127.0.0.1:${PORT}`
const USERNAME = 'archiver'
const PASSWORD = 'a sufficiently long password'

const findings = []
const pageErrors = []
const note = (sev, area, msg) => findings.push({ sev, area, msg })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let serverLog = ''
const server = spawn(BIN, ['serve', '--addr', `127.0.0.1:${PORT}`], {
  env: {
    ...process.env,
    HOME: FAKE_HOME,
    VIBEPANEL_DATA_DIR: join(DATA, 'data'),
    VIBEPANEL_TMUX_SOCKET: SOCKET,
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
  // Only this check's socket, always -- red line 1.
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
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status >= 400) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  }
  return res
}
const json = async (path, init) => (await api(path, init)).json()

/** Asked of tmux, exact-match target (red line 7), not of the panel. */
function tmuxHas(name) {
  try {
    execFileSync('tmux', ['-L', SOCKET, 'has-session', '-t', `=${name}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="login-form"]').waitFor({ timeout: 10000 })
  await page.locator('[data-testid="auth-username"]').fill(USERNAME)
  await page.locator('[data-testid="auth-password"]').fill(PASSWORD)
  await page.locator('[data-testid="auth-submit"]').click()
  await page.locator('[data-testid="project-group"]').first().waitFor({ timeout: 10000 })
  await sleep(600)
}

const group = (page, name) =>
  page.locator('[data-testid="project-group"]').filter({ hasText: name })

async function archiveFromSidebar(page, name) {
  const g = group(page, name)
  await g.hover()
  await g.locator('[data-testid="project-archive"]').click()
  await sleep(900)
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

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break } catch { /* not up */ }
    await sleep(150)
  }
  const token = /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(serverLog)?.[1]
  if (!token) throw new Error(`no setup token in the server output:\n${serverLog}`)
  const setup = await api('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ token, username: USERNAME, password: PASSWORD }),
  })
  cookie = (setup.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  await api('/api/settings/tour', { method: 'POST' })

  const dirA = mkdtempSync(join(DATA, 'alpha-'))
  const dirB = mkdtempSync(join(DATA, 'bravo-'))
  const alpha = await json('/api/projects', { method: 'POST', body: JSON.stringify({ path: dirA, name: 'alpha' }) })
  await json('/api/projects', { method: 'POST', body: JSON.stringify({ path: dirB, name: 'bravo' }) })
  const sess = await json('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ projectId: alpha.id, command: ['sleep', '600'], title: 'long job' }),
  })

  browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await signIn(page)

  // ── Archive from the sidebar ─────────────────────────────────────────────
  if ((await page.locator('[data-testid="archived-open"]').count()) !== 0) {
    note('FAIL', 'sidebar', 'the archived line is there with nothing archived')
  }
  await archiveFromSidebar(page, 'alpha')
  if ((await group(page, 'alpha').count()) !== 0) {
    note('FAIL', 'archive', 'alpha is still in the sidebar after archiving it')
  }
  if ((await page.locator('[data-testid="session-row"]').filter({ hasText: 'long job' }).count()) !== 0) {
    note('FAIL', 'archive', "the archived project's session is still in the sidebar")
  }
  const entry = page.locator('[data-testid="archived-open"]')
  if (!(await entry.isVisible().catch(() => false))) {
    note('FAIL', 'sidebar', 'no archived line under the projects after archiving one')
  } else if (!/1/.test(await entry.innerText())) {
    note('FAIL', 'sidebar', `the archived line does not count one: ${JSON.stringify(await entry.innerText())}`)
  }
  if (!(await page.locator('[data-testid="toast"]').first().isVisible().catch(() => false))) {
    note('WARN', 'archive', 'archiving said nothing')
  }
  // The premise of the feature, asked of tmux.
  if (!tmuxHas(sess.tmuxName)) {
    note('FAIL', 'archive', `archiving ended ${sess.tmuxName}; it is not in tmux any more`)
  }
  await page.screenshot({ path: join(SHOTS, 'sidebar-archived.png') })

  // A session waiting inside a hidden project has to show on the line.
  await api(`/api/sessions/${sess.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'waiting' }) })
  await sleep(1200)
  if (!(await page.locator('[data-testid="archived-waiting"]').isVisible().catch(() => false))) {
    note('FAIL', 'sidebar', 'a session waiting in an archived project shows nowhere')
  }
  // The title is what another tab sees; hiding a project must not hide that.
  if (!(await page.title()).startsWith('(1)')) {
    note('FAIL', 'title', `the tab title does not count the waiting session: ${JSON.stringify(await page.title())}`)
  }
  // Collapsed, the sidebar is a rail, and the rail needs its own way there.
  await page.locator('[data-testid="sidebar"] button[title="Collapse"]').click()
  await sleep(500)
  const rail = page.locator('[data-testid="rail-archived"]')
  if (!(await rail.isVisible().catch(() => false))) {
    note('FAIL', 'rail', 'the collapsed sidebar has no way to the archived projects')
  } else {
    await rail.click()
    await sleep(400)
    if (!(await page.locator('[data-testid="archived-dialog"]').isVisible().catch(() => false))) {
      note('FAIL', 'rail', 'the rail\'s archived button opened nothing')
    }
    await page.keyboard.press('Escape')
    await sleep(300)
  }
  await page.locator('[data-testid="sidebar-rail"] button').first().click()
  await sleep(500)

  // ── The archived list ────────────────────────────────────────────────────
  await entry.click()
  await sleep(500)
  const dialog = page.locator('[data-testid="archived-dialog"]')
  if (!(await dialog.isVisible().catch(() => false))) {
    note('FAIL', 'list', 'the archived line opened nothing')
  } else {
    const rows = dialog.locator('[data-testid="archived-row"]')
    if ((await rows.count()) !== 1 || !(await rows.first().innerText()).includes('alpha')) {
      note('FAIL', 'list', `the archived list is not alpha: ${JSON.stringify(await dialog.innerText())}`)
    }
    if (!(await dialog.locator('[data-testid="archived-running"]').isVisible().catch(() => false))) {
      note('FAIL', 'list', 'the archived list does not say the session is still running')
    }
    await page.screenshot({ path: join(SHOTS, 'list.png') })
    // Escape answers the question on top, not the list under it.
    await dialog.locator('[data-testid="archived-remove"]').click()
    await sleep(400)
    await page.keyboard.press('Escape')
    await sleep(400)
    if (!(await dialog.isVisible().catch(() => false))) {
      note('FAIL', 'list', 'one Escape on the delete question closed the archived list too')
    }
    if (!tmuxHas(sess.tmuxName)) note('FAIL', 'list', 'cancelling the delete question ended the session')
    await dialog.locator('[data-testid="archived-restore"]').click()
    await sleep(1000)
    if ((await group(page, 'alpha').count()) !== 1) {
      note('FAIL', 'list', 'restoring from the list did not bring alpha back')
    }
    if ((await page.locator('[data-testid="session-row"]').filter({ hasText: 'long job' }).count()) !== 1) {
      note('FAIL', 'list', "alpha came back without its session")
    }
    await page.keyboard.press('Escape')
    await sleep(300)
  }
  if ((await page.locator('[data-testid="archived-open"]').count()) !== 0) {
    note('FAIL', 'sidebar', 'the archived line stayed after the last archived project came back')
  }

  // ── The picker: the shelf ────────────────────────────────────────────────
  await archiveFromSidebar(page, 'alpha')
  await page.locator('[data-testid="add-project"]').click()
  await sleep(800)
  const picker = page.locator('[data-testid="dir-picker"]')
  const shelfRow = picker.locator('[data-testid="dir-archived-row"]')
  if ((await shelfRow.count()) !== 1) {
    note('FAIL', 'picker', `the picker offers ${await shelfRow.count()} archived projects, want alpha`)
  }
  await picker.locator('[data-testid="dir-search"]').fill('alp')
  await sleep(300)
  if ((await shelfRow.count()) !== 1) {
    note('FAIL', 'picker', 'typing part of an archived project\'s name hid it')
  }
  await picker.locator('[data-testid="dir-search"]').fill('zzzz')
  await sleep(300)
  if ((await shelfRow.count()) !== 0) {
    note('FAIL', 'picker', 'a filter that matches nothing still shows the archived project')
  }
  await picker.locator('[data-testid="dir-search"]').fill('')
  await sleep(300)
  await page.screenshot({ path: join(SHOTS, 'picker-shelf.png') })
  await shelfRow.first().click()
  await sleep(1200)
  if ((await picker.count()) !== 0) note('FAIL', 'picker', 'restoring from the shelf left the picker open')
  if ((await group(page, 'alpha').count()) !== 1) note('FAIL', 'picker', 'the shelf did not bring alpha back')

  // ── The picker: its directory, typed ─────────────────────────────────────
  await archiveFromSidebar(page, 'alpha')
  await page.locator('[data-testid="add-project"]').click()
  await sleep(800)
  await picker.locator('[data-testid="dir-search"]').fill(dirA)
  await sleep(400)
  const confirm = picker.locator('[data-testid="dir-confirm"]')
  if ((await confirm.getAttribute('data-restores')) !== alpha.id) {
    note('FAIL', 'picker', `the confirm button for alpha's directory does not restore it: ${JSON.stringify(await confirm.innerText())}`)
  }
  if (!(await confirm.innerText()).includes('alpha')) {
    note('FAIL', 'picker', `the confirm button does not name the project it restores: ${JSON.stringify(await confirm.innerText())}`)
  }
  await page.screenshot({ path: join(SHOTS, 'picker-typed.png') })
  await confirm.click()
  await sleep(1200)
  const st = await json('/api/state')
  if (st.projects.length !== 2 || st.archived.length !== 0) {
    note('FAIL', 'picker', `after restoring by directory: ${st.projects.length} projects, ${st.archived.length} archived; want 2 and 0 -- a duplicate is the bug this prevents`)
  }

  // ── The picker: a name and Enter ─────────────────────────────────────────
  // What a person does in a text field. With nothing in this directory
  // matching, Enter used to offer a new folder named "alp".
  await archiveFromSidebar(page, 'alpha')
  await page.locator('[data-testid="add-project"]').click()
  await sleep(800)
  await picker.locator('[data-testid="dir-search"]').fill('alp')
  await sleep(300)
  await picker.locator('[data-testid="dir-search"]').press('Enter')
  await sleep(1200)
  if ((await picker.count()) !== 0) {
    note('FAIL', 'picker', 'Enter on a name matching one archived project left the picker open'
      + ((await page.locator('[data-testid="dir-new-row"]').count()) ? ', offering a new folder instead' : ''))
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.keyboard.press('Escape')
    await sleep(300)
  }
  if ((await group(page, 'alpha').count()) !== 1) note('FAIL', 'picker', 'Enter on its name did not bring alpha back')

  // ── Everything archived ──────────────────────────────────────────────────
  await archiveFromSidebar(page, 'alpha')
  await archiveFromSidebar(page, 'bravo')
  // The line itself, not the list around it: "Archived · 2" under it would
  // satisfy any test for the word, and did, while the line said "add a project".
  const empty = await page.locator('[data-testid="sidebar-empty"]').innerText().catch(() => '')
  if (!/archived|归档/i.test(empty)) {
    note('FAIL', 'sidebar', `with every project archived the sidebar reads like a fresh install: ${JSON.stringify(empty)}`)
  }
  await page.screenshot({ path: join(SHOTS, 'all-archived.png') })
  for (const p of (await json('/api/state')).archived) {
    await api(`/api/projects/${p.id}/restore`, { method: 'POST' })
  }
  await sleep(800)

  // ── The setting ──────────────────────────────────────────────────────────
  await page.locator('[data-testid="settings-open"]').click()
  await sleep(600)
  await page.locator('[data-testid="settings-group-sessions"]').click()
  await sleep(500)
  const r30 = page.locator('[data-testid="archive-idle-30"]')
  await r30.scrollIntoViewIfNeeded()
  if (!(await page.locator('[data-testid="archive-idle-0"]').isChecked())) {
    note('FAIL', 'setting', 'the idle rule is not off by default')
  }
  await r30.check()
  await sleep(800)
  if ((await json('/api/settings')).archiveIdleDays !== 30) {
    note('FAIL', 'setting', 'choosing 30 days did not reach the server')
  }
  await page.locator('[data-testid="settings-close"]').click()
  await sleep(300)

  // ── A phone, both themes ─────────────────────────────────────────────────
  await api(`/api/projects/${alpha.id}/archive`, { method: 'POST' })
  for (const scheme of ['light', 'dark']) {
    const phone = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      colorScheme: scheme,
    })
    const p = await phone.newPage()
    p.on('pageerror', (e) => pageErrors.push(String(e)))
    await signIn(p).catch(async () => {
      // A phone lands on the session view, not on the list; the list is
      // behind the menu button.
    })
    await p.locator('[data-testid="menu-button"]').click().catch(() => {})
    await sleep(500)
    const line = p.locator('[data-testid="archived-open"]')
    if (!(await line.isVisible().catch(() => false))) {
      note('FAIL', `phone-${scheme}`, 'the archived line is not on the phone\'s project list')
      await phone.close()
      continue
    }
    await fitsWidth(p, '[data-testid="archived-open"]', `phone-${scheme}`)
    await line.click()
    await sleep(600)
    if (!(await p.locator('[data-testid="archived-dialog"]').isVisible().catch(() => false))) {
      note('FAIL', `phone-${scheme}`, 'the archived line opened nothing on a phone')
    } else {
      await fitsWidth(p, '[data-testid="archived-dialog"]', `phone-${scheme}`)
      const restore = p.locator('[data-testid="archived-restore"]').first()
      const box = await restore.boundingBox()
      if (!box || box.height < 28) note('WARN', `phone-${scheme}`, `the restore button is ${box?.height ?? 0}px tall`)
    }
    await p.screenshot({ path: join(SHOTS, `phone-${scheme}.png`) })
    await phone.close()
  }
} catch (err) {
  note('FAIL', 'harness', String(err?.stack ?? err))
} finally {
  for (const e of [...new Set(pageErrors)]) note('FAIL', 'js', `uncaught: ${e}`)
  await cleanup()
}

const fails = findings.filter((f) => f.sev === 'FAIL').length
console.log(`\n=== archive check: ${fails} FAIL, ${findings.filter((f) => f.sev === 'WARN').length} WARN ===`)
for (const f of findings) console.log(`[${f.sev}] ${f.area}: ${f.msg}`)
console.log(`\nscreenshots: ${SHOTS}`)
await new Promise((resolve) => process.stdout.write('', resolve))
process.exit(fails > 0 ? 1 : 0)
