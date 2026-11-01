// The Members page against the real binary: the list beside what root knows,
// a member's sessions and projects read through the owner's panel, the Claude
// grant and the restart through pantheon-member, the page with no sudo, and a
// member who opens it. Layout at three widths in both themes.
//
// Root is never touched. The panel runs `sudo -n -- pantheon-member …`, found
// on PATH, and this puts a fake `sudo` first on the panel's PATH: it answers
// status from a file and records every other verb. A fake member instance is
// a node HTTP server on loopback, which is all the owner's panel ever reads.
import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHTTP } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertFreshBuild } from './lib/fresh.mjs'
import { sweepStaleSockets } from './lib/stale.mjs'

const BIN = process.argv[2] ?? new URL('../../vibepanel', import.meta.url).pathname
assertFreshBuild(BIN, new URL('../../', import.meta.url).pathname)
sweepStaleSockets((msg) => console.log(`==> ${msg}`))
const SHOTS = process.argv[3] ?? join(tmpdir(), 'vpmem-shots')
mkdirSync(SHOTS, { recursive: true })

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
const PORT = await freePort()
const SOCKET = `vpmem-${process.pid}`
const DATA = mkdtempSync(join(tmpdir(), 'vpmem-'))
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'vpmem-home-'))
const BASE = `http://127.0.0.1:${PORT}`
const USERNAME = 'owner'
const PASSWORD = 'a sufficiently long password'
const MEMBER = 'li'
const MEMBER_PASSWORD = 'a member password, long'

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

// The fake sudo. `noroot` present: refuse, as sudo -n does without a rule.
const BIN_DIR = join(DATA, 'bin')
mkdirSync(BIN_DIR)
const CALLS = join(DATA, 'calls')
const CLAUDE = join(DATA, 'claude-granted')
const NOROOT = join(DATA, 'noroot')
writeFileSync(
  join(BIN_DIR, 'sudo'),
  `#!/bin/sh
[ -e ${NOROOT} ] && { echo 'sudo: a password is required' >&2; exit 1; }
shift 3  # -n -- /usr/local/sbin/pantheon-member
printf '%s\\n' "$*" >> ${CALLS}
case "$1" in
  status) c=false; [ -e ${CLAUDE} ] && c=true
    printf '{"members":{"${MEMBER}":{"unit":"active","memoryCurrent":220200960,"memoryMax":1073741824,"claude":%s}}}\\n' "$c" ;;
  grant-claude) cat > /dev/null; : > ${CLAUDE}; echo '[ ok ] granted' ;;
  revoke-claude) rm -f ${CLAUDE}; echo '[ ok ] revoked' ;;
  *) echo "[ ok ] $1" ;;
esac
`,
)
chmodSync(join(BIN_DIR, 'sudo'), 0o755)

// The fake member instance: what the owner's panel reads of a member.
const INSTANCE_PORT = await freePort()
const instance = createHTTP((req, res) => {
  const send = (body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.url === '/api/health') return send({ ok: true, version: 'v-member' })
  if (req.url === '/api/state')
    return send({
      projects: [{ id: 'p1', name: 'thesis-experiments' }],
      sessions: [
        { id: 's1', projectId: 'p1', title: 'ablation sweep on the 7B checkpoint', state: 'waiting' },
        { id: 's2', projectId: 'p1', title: 'figures', state: 'working' },
      ],
    })
  if (req.url === '/api/home')
    return send({
      available: true,
      generatedAt: '',
      todos: [],
      warnings: [],
      projects: [
        {
          id: 'thesis-experiments',
          status: 'active',
          goal: 'Run the ablations for chapter four and draw the figures.',
          sessions: [],
          latestReport: { title: 'Sweep halfway', summary: 'Twelve of twenty-four runs are done.', at: '', file: '', kind: 'report', needsUser: false },
        },
      ],
    })
  res.writeHead(404)
  res.end()
})
await new Promise((r) => instance.listen(INSTANCE_PORT, '127.0.0.1', r))

let serverLog = ''
const server = spawn(BIN, ['serve', '--addr', `127.0.0.1:${PORT}`], {
  env: {
    ...process.env,
    PATH: `${BIN_DIR}:${process.env.PATH}`,
    HOME: FAKE_HOME,
    VIBEPANEL_DATA_DIR: join(DATA, 'data'),
    VIBEPANEL_TMUX_SOCKET: SOCKET,
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
  instance.close()
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

async function signIn(page, user, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="login-form"]').waitFor({ timeout: 10000 })
  await page.locator('[data-testid="auth-username"]').fill(user)
  await page.locator('[data-testid="auth-password"]').fill(password)
  await page.locator('[data-testid="auth-submit"]').click()
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

const calls = () => (existsSync(CALLS) ? readFileSync(CALLS, 'utf8').trim().split('\n') : [])

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
  await api('/api/members', {
    method: 'POST',
    body: JSON.stringify({ username: MEMBER, password: MEMBER_PASSWORD, linuxUser: MEMBER, upstream: `127.0.0.1:${INSTANCE_PORT}`, token: 'gateway-bearer' }),
  })

  browser = await chromium.launch()

  // ── the owner's page, both themes, three widths ──────────────────────────
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width: 1280, height: 860 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await signIn(page, USERNAME, PASSWORD)
    await page.locator('[data-testid="project-group"], [data-testid="sidebar"]').first().waitFor({ timeout: 10000 })
    await page.goto(`${BASE}/members`, { waitUntil: 'domcontentloaded' })
    const row = page.locator('[data-testid="member-row"]')
    if (!(await until(() => row.first().isVisible()))) {
      note('FAIL', 'list', `${scheme}: no member row`)
      await ctx.close()
      continue
    }
    if (!/v-member/.test(await row.locator('[data-testid="member-status"]').innerText())) note('FAIL', 'list', 'the member is not shown as answering, with its version')
    if (!/210 MiB \/ 1\.0 GiB/.test(await row.locator('[data-testid="member-memory"]').innerText().catch(() => '')))
      note('FAIL', 'list', 'the memory their sessions use is not shown against the ceiling')
    await row.locator('[data-testid="member-view"]').click()
    const detail = row.locator('[data-testid="member-detail"]')
    if (!(await until(() => detail.isVisible()))) note('FAIL', 'detail', 'opening a member shows nothing')
    else {
      const text = await detail.innerText()
      for (const want of ['ablation sweep', 'thesis-experiments', 'Twelve of twenty-four']) {
        if (!text.includes(want)) note('FAIL', 'detail', `the member's sessions and projects are missing "${want}"`)
      }
    }
    for (const width of [390, 820, 1280]) {
      await page.setViewportSize({ width, height: 860 })
      await sleep(250)
      await fitsWidth(page, '[data-testid="members-page"]', `layout ${scheme} ${width}`)
      await page.screenshot({ path: join(SHOTS, `members-${scheme}-${width}.png`), fullPage: true })
    }
    await ctx.close()
  }

  // ── actions through pantheon-member ──────────────────────────────────────
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1024, height: 860 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await signIn(page, USERNAME, PASSWORD)
    await page.locator('[data-testid="project-group"], [data-testid="sidebar"]').first().waitFor({ timeout: 10000 })
    await page.goto(`${BASE}/members`, { waitUntil: 'domcontentloaded' })
    const row = page.locator('[data-testid="member-row"]')
    await row.first().waitFor({ timeout: 10000 })
    await row.locator('[data-testid="member-claude-grant"]').click()
    await row.locator('[data-testid="member-form"] input').fill('sk-ant-oat01-a-token-for-the-check-only')
    await row.locator('[data-testid="member-form-submit"]').click()
    if (!(await until(() => row.locator('[data-testid="member-claude-revoke"]').isVisible())))
      note('FAIL', 'claude', 'after a grant the page does not offer to revoke it')
    if (calls().some((c) => c.includes('sk-ant-oat01'))) note('FAIL', 'claude', 'the token reached the command line')
    await row.locator('[data-testid="member-restart"]').click()
    if (!(await until(async () => calls().includes(`restart ${MEMBER}`)))) note('FAIL', 'restart', 'restart did not run pantheon-member restart')
    else note('PASS', 'actions', 'grant and restart go through pantheon-member, the token by stdin')

    // Without sudo: the page says what to run, and adding is not offered.
    writeFileSync(NOROOT, '')
    await page.reload({ waitUntil: 'domcontentloaded' })
    if (!(await until(() => page.locator('[data-testid="members-no-root"]').isVisible())))
      note('FAIL', 'noroot', 'with no sudo the page does not say what to run instead')
    if (!(await page.locator('[data-testid="member-add-open"]').isDisabled())) note('FAIL', 'noroot', 'with no sudo, Add is still offered')
    if (await page.locator('[data-testid="member-restart"]').count()) note('FAIL', 'noroot', 'with no sudo, Restart is still offered')
    await page.screenshot({ path: join(SHOTS, 'members-noroot.png'), fullPage: true })
    rmSync(NOROOT)

    // The settings dialog's rail leads here.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="settings-open"]').first().click({ timeout: 10000 })
    const href = await page.locator('[data-testid="settings-members-link"]').getAttribute('href', { timeout: 5000 }).catch(() => null)
    if (href !== '/members') note('FAIL', 'settings', `the settings rail does not lead to the Members page (${href})`)
    await ctx.close()
  }

  // ── a member who opens the page ──────────────────────────────────────────
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1024, height: 860 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await signIn(page, MEMBER, MEMBER_PASSWORD)
    await sleep(1000)
    const before = calls().length
    await page.goto(`${BASE}/members`, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    const body = await page.locator('[data-testid="members-page"]').innerText().catch(() => '')
    if (body.includes(MEMBER_PASSWORD) || (await page.locator('[data-testid="member-row"]').count()) > 0)
      note('FAIL', 'member', 'a member sees the member list')
    if (calls().length !== before) note('FAIL', 'member', 'a member opening the page ran pantheon-member')
    // Whether a member's settings rail hides the link is not asked here: the
    // fake instance has no socket, so a member's main page never draws. It
    // was looked at once against a real member instance (build-log 2026-11-01).
    await page.screenshot({ path: join(SHOTS, 'members-as-member.png') })
    await ctx.close()
  }
} catch (err) {
  note('FAIL', 'harness', String(err?.stack ?? err))
} finally {
  for (const e of [...new Set(pageErrors)]) note('FAIL', 'js', `uncaught: ${e}`)
  await cleanup()
}

const fails = findings.filter((f) => f.sev === 'FAIL').length
console.log(`\n=== members check: ${fails} FAIL, ${findings.filter((f) => f.sev === 'WARN').length} WARN ===`)
for (const f of findings) console.log(`[${f.sev}] ${f.area}: ${f.msg}`)
console.log(`shots: ${SHOTS}`)
process.exit(fails > 0 ? 1 : 0)
