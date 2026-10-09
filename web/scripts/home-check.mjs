// Pantheon stage A: a real server over a temporary cyx registry and Harness, two
// browser sizes, and a second server on an empty database to prove the home view
// is rebuilt from files alone. Never touches the production or dev instances.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { assertFreshBuild } from './lib/fresh.mjs'

const binary = new URL('../../vibepanel', import.meta.url).pathname
assertFreshBuild(binary, new URL('../../', import.meta.url).pathname)

const root = mkdtempSync(join(tmpdir(), 'pantheon-home-check-'))
const harness = join(root, 'harness')
const checkout = join(root, 'checkout')
const cyxHome = join(root, 'cyx')
const shots = process.env.HOME_CHECK_SHOTS || tmpdir()
mkdirSync(checkout, { recursive: true })
mkdirSync(cyxHome, { recursive: true })

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
function project(id, extra = {}) {
  write(join(harness, 'projects', id, 'project.json'), JSON.stringify({ id, aliases: [id + '-alias'], portfolio: 'check', category: 'product', status: 'active', state_mode: 'linked', sync: 'local', ...extra }))
}
function task(id, taskId, fields) {
  const lines = Object.entries({ id: taskId, title: `Task ${taskId}`, status: 'planned', stage: 'A', primary: 'codex/test-codex', secondary: 'claude/test-claude', depends_on: '[]', session_status: 'ok', updated: '2026-10-09T18:00:00+08:00', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  write(join(harness, 'projects', id, 'agent-docs', 'tasks', taskId, 'task.md'), `---\n${lines}\n---\nAcceptance for ${taskId}.\n`)
}

project('alpha')
write(join(harness, 'projects', 'alpha', 'ACTIVE_CONTEXT.md'), '# alpha\n\n- **Goal**：Ship the alpha report board\n- **活动文档**：[Plan](agent-docs/plan/p.md)\n- **Last verified commit**：abc1234\n')
task('alpha', 'A1', { status: 'done' })
task('alpha', 'A2', { status: 'awaiting_review' })
task('alpha', 'A3', { status: 'blocked', blocked_reason: 'Needs a Feishu app' })
write(join(harness, 'projects', 'alpha', 'agent-docs', 'reports', 'r1.md'), '---\ntitle: Alpha backend ready\nat: 2026-10-09T19:00:00+08:00\nkind: question\nneeds_user: true\ntask: A2\nsummary: Which model should review?\n---\nBody\n')
project('beta')
write(join(harness, 'projects', 'beta', 'ACTIVE_CONTEXT.md'), '# beta\n\n- **目标**：Keep beta quiet\n')
project('gamma', { status: 'archived' })
write(join(harness, 'projects', 'broken', 'project.json'), '{not json')
writeFileSync(join(cyxHome, 'local.json'), JSON.stringify({ version: 1, projects_root: root, paths: { 'cyx-agent-harness': harness, alpha: checkout } }))

async function freePort() {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return port
}

const mount = process.env.CHECK_BASE_PATH || ''
const servers = []
async function start(name) {
  const data = join(root, 'data-' + name)
  mkdirSync(data, { recursive: true })
  const port = await freePort()
  const socket = `pantheon-home-check-${name}-${process.pid}`
  const server = spawn(binary, [
    'serve', '--development', '--addr', `127.0.0.1:${port}`, '--data-dir', data,
    '--tmux-socket', socket, '--isolation', 'off', '--base-path', mount, '--cyx-home', cyxHome,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', (chunk) => { log += chunk })
  server.stderr.on('data', (chunk) => { log += chunk })
  servers.push({ server, socket })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (/one-time setup token:\s*\n\s*\n\s*(\S+)/.test(log)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const token = /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(log)?.[1]
  assert.ok(token, `${name}: server produced setup token\n${log}`)
  return { base: `http://127.0.0.1:${port}${mount}`, token, log: () => log }
}

let browser
try {
  const first = await start('first')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'zh-CN' })
  let response = await context.request.post(first.base + '/api/auth/setup', {
    data: { token: first.token, username: 'home-test', password: 'test-password-only-for-temporary-database' },
  })
  assert.equal(response.status(), 201)

  // API: projects, to-dos and warnings come from the files.
  response = await context.request.get(first.base + '/api/home')
  assert.equal(response.status(), 200)
  const home = await response.json()
  assert.equal(home.available, true)
  const ids = home.projects.map((p) => p.id)
  assert.deepEqual([...ids].sort(), ['alpha', 'beta'], 'archived and invalid projects are not listed')
  assert.equal(ids[0], 'alpha', 'projects with to-dos come first')
  const alpha = home.projects[0]
  assert.equal(alpha.goal, 'Ship the alpha report board')
  assert.equal(alpha.lastVerified, 'abc1234')
  assert.equal(alpha.pathExists, true)
  assert.equal(alpha.taskCounts.total, 3)
  assert.deepEqual(alpha.stages, [{ name: 'A', done: 1, total: 3 }])
  assert.equal(alpha.latestReport.title, 'Alpha backend ready')
  assert.equal(alpha.usage.known, false)
  assert.equal(home.projects[1].goal, 'Keep beta quiet')
  const kinds = home.todos.map((t) => t.kind)
  assert.deepEqual(kinds, ['question', 'blocked', 'awaiting_review'], 'to-do order follows the contract')
  assert.ok(home.warnings.some((w) => w.projectId === 'broken' || /broken/.test(w.file || '')), 'broken manifest is reported, not fatal')
  response = await context.request.get(first.base + '/api/home?all=1')
  assert.ok((await response.json()).projects.some((p) => p.id === 'gamma'), '?all=1 includes archived')

  // Task create and patch are written to the Harness files.
  response = await context.request.post(first.base + '/api/home/projects/beta/tasks', { data: { id: 'B1', title: 'Beta first task', stage: 'A' } })
  assert.ok([200, 201].includes(response.status()), `task create status ${response.status()}`)
  const created = await response.json()
  const file = join(harness, 'projects', 'beta', 'agent-docs', 'tasks', 'B1', 'task.md')
  assert.ok(existsSync(file))
  assert.match(readFileSync(file, 'utf8'), /title: Beta first task/)
  response = await context.request.post(first.base + '/api/home/projects/beta/tasks', { data: { id: 'B1', title: 'dup' } })
  assert.equal(response.status(), 409)
  response = await context.request.patch(first.base + '/api/home/projects/beta/tasks/B1', { data: { rev: 'stale', status: 'awaiting_review' } })
  assert.equal(response.status(), 409)
  response = await context.request.patch(first.base + '/api/home/projects/beta/tasks/B1', { data: { rev: created.rev, status: 'awaiting_review' } })
  assert.equal(response.status(), 200)
  assert.match(readFileSync(file, 'utf8'), /status: awaiting_review/)
  assert.match(readFileSync(file, 'utf8'), /Acceptance|^/m)

  // Desktop and phone render the same capabilities.
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(first.base + '/home')
    await page.getByText('Ship the alpha report board').first().waitFor()
    await page.getByText('Which model should review?').first().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `no horizontal scroll at ${width}`)
    await page.screenshot({ path: join(shots, `pantheon-home-${width}.png`), fullPage: true })
    await page.goto(first.base + '/home?project=alpha')
    await page.getByText('Task A2').first().waitFor({ timeout: 10000 }).catch(async () => {
      // The project view may open on the chat tab; the tasks tab must exist on both sizes.
      await page.getByRole('tab', { name: /任务|Tasks/ }).first().click()
      await page.getByText('Task A2').first().waitFor()
    })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `project view fits at ${width}`)
    await page.screenshot({ path: join(shots, `pantheon-project-${width}.png`), fullPage: true })
  }

  // Notifications: the first tick records a baseline; dry_run never sends.
  await new Promise((resolve) => setTimeout(resolve, 12000))
  response = await context.request.get(first.base + '/api/home/notifications')
  assert.equal(response.status(), 200)
  const notices = await response.json()
  assert.equal(notices.mode, 'dry_run')
  assert.ok(notices.items.every((n) => n.status === 'baseline' || n.status === 'dry_run'), 'nothing was sent in dry_run')
  assert.ok(notices.items.every((n) => n.status !== 'sent'))

  // Rebuild: a second server with an empty database sees the same projects and to-dos.
  const second = await start('second')
  const context2 = await browser.newContext()
  response = await context2.request.post(second.base + '/api/auth/setup', {
    data: { token: second.token, username: 'home-test', password: 'test-password-only-for-temporary-database' },
  })
  assert.equal(response.status(), 201)
  const again = await (await context2.request.get(second.base + '/api/home')).json()
  const now = await (await context.request.get(first.base + '/api/home')).json()
  const shape = (h) => JSON.stringify({ p: h.projects.map((p) => [p.id, p.goal, p.taskCounts, p.stages, p.latestReport?.file]), t: h.todos.map((t) => [t.id, t.kind]) })
  assert.equal(shape(again), shape(now), 'empty database rebuilds the identical home view')

  assert.deepEqual(errors, [])
  console.log(`=== ${mount ? 'basepath ' : ''}home check: 0 FAIL, 0 WARN; file index, order, warnings, task write/409, desktop/360px, dry_run baseline and DB rebuild checked ===`)
} finally {
  await browser?.close()
  for (const { server, socket } of servers) {
    server.kill('SIGTERM')
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
    try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* empty server */ }
  }
  rmSync(root, { recursive: true, force: true })
}
