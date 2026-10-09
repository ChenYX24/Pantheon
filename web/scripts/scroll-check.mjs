// Real browser -> WebSocket -> throwaway tmux -> synthetic fullscreen app.
// No model processes, user transcripts, existing sockets or credentials.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { rows } from './lib/screen.mjs'

const binary = resolve(process.argv[2] ?? '../vibepanel')
const evidence = resolve(process.argv[3] ?? '.')
const data = mkdtempSync(join(tmpdir(), 'vp-scroll-'))
const projectDir = join(data, 'project')
mkdirSync(projectDir)
const socket = `vp-scroll-${process.pid}`
const port = await new Promise((yes) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const n = s.address().port
    s.close(() => yes(n))
  })
})
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fixture = join(data, 'fixture.py')
writeFileSync(fixture, String.raw`import os, sys, tty, termios, json, re
mode, state_path = sys.argv[1:]
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
state = dict(top=100, pages=0, arrows=0, mouse=0, draft='keep-me')
def save():
    with open(state_path + '.new', 'w') as f: json.dump(state, f)
    os.replace(state_path + '.new', state_path)
def draw():
    sys.stdout.write('\x1b[H\x1b[2JTRANSCRIPT_%03d\r\nDRAFT=%s' % (state['top'], state['draft']))
    sys.stdout.flush()
try:
    if mode == 'full':
        sys.stdout.write('\x1b[?1049h\x1b[?1007h')
        draw()
    else:
        sys.stdout.write(''.join('NORMAL_%03d\r\n' % i for i in range(400)))
        sys.stdout.flush()
    save()
    pending = b''
    while True:
        pending += os.read(fd, 4096)
        while pending:
            if pending.startswith(b'\x1b[5~') or pending.startswith(b'\x1b[6~'):
                state['top'] = min(100, max(0, state['top'] + (-10 if pending[2:3] == b'5' else 10)))
                state['pages'] += 1
                pending = pending[4:]
                draw()
            elif pending.startswith(b'\x1b[A') or pending.startswith(b'\x1b[B') or pending.startswith(b'\x1bOA') or pending.startswith(b'\x1bOB'):
                state['arrows'] += 1
                state['draft'] = 'WRONG-HISTORY-INPUT'
                pending = pending[3:]
                draw()
            elif pending.startswith(b'\x1b[<'):
                m = re.match(rb'\x1b\[<(\d+);\d+;\d+[Mm]', pending)
                if not m: break
                if int(m[1]) in (64,65): state['mouse'] += 1
                pending = pending[len(m[0]):]
            elif any(k.startswith(pending) for k in [b'\x1b[5~',b'\x1b[6~',b'\x1b[A',b'\x1b[B',b'\x1bOA',b'\x1bOB',b'\x1b[<']):
                break
            else:
                if pending[:1] == b'm':
                    sys.stdout.write('\x1b[?1006h\x1b[?1003h')
                    sys.stdout.flush()
                pending = pending[1:]
            save()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
`)
// Omit HOME entirely: server startup otherwise scans real Agent transcripts
// and may upgrade installed Claude hooks. No caller environment is inherited.
const server = spawn(binary, ['serve', '--addr', `127.0.0.1:${port}`,
  '--data-dir', data, '--tmux-socket', socket, '--tls', 'off', '--domain', 'localhost',
  '--isolation', 'off'], { env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = '', cookie = '', browser
server.stdout.on('data', (s) => { log += s })
server.stderr.on('data', (s) => { log += s })
const api = async (path, body) => {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body) })
  assert(r.ok, `${path}: HTTP ${r.status}`)
  if (path === '/api/auth/setup') cookie = r.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ')
  return r
}
const until = async (f, label) => {
  for (let i = 0; i < 40; i++) { if (await f()) return; await sleep(150) }
  throw new Error(label)
}
const readState = (name) => JSON.parse(readFileSync(join(data, name + '.json'), 'utf8'))
const checks = []
try {
  await until(async () => { try { return (await fetch(base + '/api/health')).ok } catch { return false } }, 'fixture server unavailable')
  const token = /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(log)?.[1]
  assert(token, 'fixture setup token absent (server log withheld)')
  await api('/api/auth/setup', { token, username: 'scroll-fixture', password: 'synthetic-scroll-fixture-password' })
  await api('/api/settings/tour', {})
  const project = await (await api('/api/projects', { path: projectDir, name: 'scroll fixture' })).json()
  const session = async (mode) => (await api('/api/sessions', { projectId: project.id,
    command: ['/usr/bin/python3', fixture, mode, join(data, mode + '.json')],
    title: mode, cols: 100, rows: 30 })).json()
  const full = await session('full')
  await until(async () => (await (await api('/api/state')).json()).fullscreen.includes(full.id), 'fullscreen state not reported')
  browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('vibepanel.renderer', 'dom'))
  const page = await ctx.newPage()
  await page.goto(base)
  await page.locator('[data-testid="auth-username"]').fill('scroll-fixture')
  await page.locator('[data-testid="auth-password"]').fill('synthetic-scroll-fixture-password')
  await page.locator('[data-testid="auth-submit"]').click()
  const screen = page.locator('[data-testid="main-terminal"]:visible .xterm-screen')
  const select = async (name) => {
    await page.locator('[data-testid="session-row"]', { hasText: name }).first().click()
    await screen.waitFor()
    await sleep(600)
    await screen.hover()
  }
  await select('full')
  await until(async () => (await rows(page)).join('\n').includes('TRANSCRIPT_100'), 'fixture screen absent')
  await page.mouse.wheel(0, -120)
  await until(() => readState('full').top < 100, 'wheel never reached the fullscreen transcript')
  await until(async () => (await rows(page)).join('\n').includes('TRANSCRIPT_090'), 'earlier transcript not rendered')
  checks.push('wheel up reaches earlier fullscreen transcript through real PTY')
  await page.mouse.wheel(0, 120)
  await until(() => readState('full').top === 100, 'wheel down did not return to latest')
  assert.equal(readState('full').draft, 'keep-me')
  assert.equal(readState('full').arrows, 0)
  checks.push('wheel down returns to latest; no arrow/history input or draft changes')
  const rail = page.locator('[data-testid="main-terminal"]:visible [data-testid="terminal-scrollbar"]')
  await rail.waitFor({ state: 'visible', timeout: 5000 })
  const railBox = await rail.boundingBox()
  const terminalBox = await screen.boundingBox()
  assert(railBox.width <= 16, 'fullscreen scrollbar is not narrow')
  assert(terminalBox.x + terminalBox.width <= railBox.x + 1, 'scrollbar obscures terminal columns')
  const up = rail.locator('[data-testid="terminal-scroll-up"]')
  const down = rail.locator('[data-testid="terminal-scroll-down"]')
  const handle = rail.locator('[data-testid="terminal-scroll-handle"]')
  await up.click()
  await until(() => readState('full').top === 90, 'scrollbar up button did not page')
  await down.click()
  await until(() => readState('full').top === 100, 'scrollbar down button did not page')
  checks.push('narrow visible scrollbar reserves text space and both buttons page the transcript')
  const dragHandle = async (dy) => {
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 8 })
    await page.mouse.up()
  }
  await dragHandle(-48)
  await until(() => readState('full').top < 100, 'dragging scrollbar did not reach earlier transcript')
  await dragHandle(48)
  await until(() => readState('full').top === 100, 'dragging scrollbar down did not return')
  assert.equal(readState('full').draft, 'keep-me')
  assert.equal(readState('full').arrows, 0)
  checks.push('dragging the handle pages both ways without changing the draft')
  await handle.focus()
  await page.keyboard.press('ArrowUp')
  await until(() => readState('full').top === 90, 'keyboard scrollbar navigation failed')
  await page.keyboard.press('ArrowDown')
  await until(() => readState('full').top === 100, 'keyboard scrollbar return failed')
  await handle.hover()
  await page.mouse.wheel(0, -120)
  await until(() => readState('full').top === 90, 'wheel over scrollbar did not page')
  await page.mouse.wheel(0, 120)
  await until(() => readState('full').top === 100, 'wheel over scrollbar did not return')
  checks.push('scrollbar supports keyboard and wheel input')
  for (const theme of ['light', 'dark']) {
    // Persist the actual app preference, then reload so xterm also receives
    // the palette. Changing only data-theme fakes a dark page with light cells.
    const count = readState('full').pages
    await page.evaluate((value) => localStorage.setItem('vibepanel.theme', value), theme)
    await page.reload({ waitUntil: 'networkidle' })
    await rail.waitFor({ state: 'visible' })
    await until(async () => (await rows(page)).join('\n').includes('TRANSCRIPT_100'), 'theme reload did not restore latest screen')
    assert.equal(readState('full').pages, count)
    assert.notEqual(await handle.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
    await page.screenshot({ path: join(evidence, `scrollbar-${theme}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await rail.waitFor({ state: 'visible' })
  const narrowBox = await rail.boundingBox()
  assert(narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 391, 'scrollbar outside narrow viewport')
  await up.click()
  await until(() => readState('full').top === 90, 'narrow viewport scrollbar failed')
  await down.click()
  await until(() => readState('full').top === 100, 'narrow viewport scrollbar return failed')
  await until(async () => (await rows(page)).join('\n').includes('TRANSCRIPT_100'), 'narrow viewport did not render the returned page')
  await page.screenshot({ path: join(evidence, 'scrollbar-narrow.png') })
  await page.setViewportSize({ width: 1200, height: 800 })
  await screen.waitFor()
  checks.push('scrollbar is visible in light/dark themes and usable at 390px width')
  const pages = readState('full').pages
  await page.reload()
  await screen.waitFor()
  await until(async () => (await rows(page)).join('\n').includes('TRANSCRIPT_100'), 'reconnect lost screen')
  await sleep(500)
  assert.equal(readState('full').pages, pages)
  checks.push('reconnect renders existing screen without replaying wheel input')
  await screen.hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await page.mouse.wheel(120, 0)
  await sleep(300)
  assert.equal(readState('full').pages, pages)
  checks.push('zoom modifier and horizontal wheel do not page the application')
  // Only the synthetic app receives this mode toggle.
  execFileSync('tmux', ['-L', socket, 'send-keys', '-t', `=${full.tmuxName}:`, 'm'])
  await sleep(500)
  await screen.hover()
  await page.mouse.wheel(0, -120)
  await until(() => readState('full').mouse > 0, 'mouse-reporting application lost wheel input')
  assert.equal(readState('full').pages, pages)
  checks.push('mouse-reporting application receives mouse reports, not page keys')
  const mouseBefore = readState('full').mouse
  await up.click()
  await until(() => readState('full').mouse > mouseBefore, 'scrollbar did not honor app mouse protocol')
  assert.equal(readState('full').pages, pages)
  checks.push('scrollbar also honors mouse-reporting applications')
  await session('normal')
  await select('normal')
  await until(async () => (await rows(page)).join('\n').includes('NORMAL_399'), 'normal output absent')
  const before = (await rows(page)).join('\n')
  await page.mouse.wheel(0, -600)
  await until(async () => (await rows(page)).join('\n') !== before, 'normal scrollback did not move')
  assert.equal(readState('normal').pages, 0)
  assert.equal(readState('normal').arrows, 0)
  checks.push('normal terminal scrollback stays local and sends no keys')
  assert.equal(await rail.count(), 0, 'fullscreen pager leaked into normal terminal')
  const slider = page.locator('[data-testid="main-terminal"]:visible .xterm .scrollbar.vertical > .slider')
  await page.mouse.move(10, 10)
  await sleep(1300)
  assert.equal(await slider.evaluate((el) => getComputedStyle(el.parentElement).opacity), '1')
  const sliderBox = await slider.boundingBox()
  assert(sliderBox.width <= 12, 'normal scrollbar too wide')
  const beforeDrag = (await rows(page)).join('\n')
  await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y - 80, { steps: 8 })
  await page.mouse.up()
  await until(async () => (await rows(page)).join('\n') !== beforeDrag, 'normal scrollbar drag did not scroll')
  assert.equal(readState('normal').pages, 0)
  checks.push('normal scrollbar remains visible and drags real scrollback without sending input')
  await page.screenshot({ path: join(evidence, 'scroll-check.png') })
  console.log(JSON.stringify({ result: 'passed', checks, binary, fixture_data: data }))
} catch (error) {
  console.error(JSON.stringify({ result: 'failed', error: String(error), checks, binary, fixture_data: data }))
  process.exitCode = 1
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await sleep(400)
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* fixture may have exited */ }
  // Keep this task's synthetic data as local evidence; never include it in Git.
}
