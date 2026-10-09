// A real server, real SQLite, and two browser sizes; never the production socket.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { assertFreshBuild } from './lib/fresh.mjs'

assertFreshBuild(new URL('../../vibepanel', import.meta.url).pathname, new URL('../../', import.meta.url).pathname)

const data = mkdtempSync(join(tmpdir(), 'panel-board-check-'))
mkdirSync(join(data, 'skills', 'fixture'), { recursive: true })
writeFileSync(join(data, 'skills', 'fixture', 'SKILL.md'), '---\nname: fixture\ndescription: Test project capability\n---\nPreserve acceptance evidence.\n')
const socket = `panel-board-check-${process.pid}`
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const mount = process.env.CHECK_BASE_PATH || ''
const origin = `http://127.0.0.1:${port}`
const base = origin + mount
const server = spawn(new URL('../../vibepanel', import.meta.url).pathname, [
  'serve', '--planning-only', '--addr', `127.0.0.1:${port}`, '--data-dir', data,
  '--tmux-socket', socket, '--isolation', 'off', '--base-path', mount,
], { stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (chunk) => { log += chunk })
server.stderr.on('data', (chunk) => { log += chunk })
let browser
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (/one-time setup token:\s*\n\s*\n\s*(\S+)/.test(log)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const token = /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(log)?.[1]
  assert.ok(token, 'server produced setup token')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'zh-CN' })
  if (mount) {
    await context.addCookies([{ name: 'vibepanel_session', value: 'production-sentinel', url: origin }])
    await context.addInitScript(() => {
      localStorage.setItem('vibepanel.lang', 'en')
      localStorage.setItem('vibepanel.theme', 'light')
    })
  }
  const escaped = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (mount && url.origin === origin && !url.pathname.startsWith(mount + '/') && url.pathname !== mount) escaped.push(url.pathname)
  })
  let response = await context.request.post(base + '/api/auth/setup', {
    data: { token, username: 'board-test', password: 'test-password-only-for-temporary-database' },
  })
  assert.equal(response.status(), 201)
  response = await context.request.post(base + '/api/projects', { data: { name: 'Board check', path: data } })
  assert.equal(response.status(), 201)
  const project = await response.json()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base + '/projects')
    await page.getByRole('button', { name: '计划看板', exact: true }).click()
    const dialog = page.locator('main')
    await dialog.getByLabel('项目目标', { exact: true }).fill(`Goal at ${width}`)
    await dialog.getByRole('button', { name: '添加任务', exact: true }).click()
    await dialog.getByLabel('任务标题', { exact: true }).last().fill(`Task at ${width}`)
    await dialog.getByRole('button', { name: '保存看板', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('已保存 · 版本'))
    response = await context.request.get(`${base}/api/projects/${project.id}/board`)
    const saved = await response.json()
    assert.equal(saved.goal, `Goal at ${width}`)
    assert.ok(saved.tasks.some((task) => task.title === `Task at ${width}`))
    assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, `no overflow at ${width}`)
    await page.screenshot({ path: join(tmpdir(), `panel-board-${width}.png`) })
    await page.getByRole('button', { name: '项目概览', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '计划看板', exact: true }).click()
    await page.locator('main').getByLabel('项目目标', { exact: true }).waitFor()
    assert.equal(await page.locator('main').getByLabel('项目目标', { exact: true }).inputValue(), `Goal at ${width}`)
    await page.getByRole('button', { name: '项目概览', exact: true }).click()
  }
  response = await context.request.get(`${base}/api/projects/${project.id}/board`)
  const plan = await response.json()
  plan.stages = [{ id: 'P1', title: 'Browser workflow', primary: { harness: 'codex', model: 'test-codex' }, secondary: { harness: 'claude', model: 'test-claude' }, reason: 'Implement and review', budgetMinutes: 120, attemptMinutes: 30, maxAttempts: 3 }]
  plan.tasks.forEach((task) => { task.phase = 'P1'; task.acceptance = 'Browser scenario passes' })
  plan.tasks[0].verify = ["printf '%s' '" + 'approved-check-'.repeat(50) + "'"]
  response = await context.request.put(`${base}/api/projects/${project.id}/board`, { data: plan })
  assert.equal(response.status(), 200)
  await page.reload()
  await page.getByRole('button', { name: '确认阶段', exact: true }).waitFor()
  await page.getByRole('button', { name: '确认阶段', exact: true }).click()
  assert.equal(await page.getByTestId('confirm-body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'long acceptance commands fit the phone confirmation')
  await page.getByTestId('confirm-no').click()
  response = await context.request.get(`${base}/api/projects/${project.id}/workflow`)
  assert.equal((await response.json()).approvals.length, 0, 'cancelling stage confirmation grants no approval')
  await page.getByRole('button', { name: '确认阶段', exact: true }).click()
  await page.getByTestId('confirm-yes').click()
  await page.getByRole('button', { name: '已确认', exact: true }).waitFor()
  await page.getByRole('button', { name: '计划看板', exact: true }).click()
  await page.getByLabel('项目目标', { exact: true }).fill('Unsaved edit')
  await page.getByRole('button', { name: '项目概览', exact: true }).click()
  await page.getByTestId('confirm-no').click()
  assert.equal(await page.getByLabel('项目目标', { exact: true }).inputValue(), 'Unsaved edit', 'tab navigation preserves dismissed draft')
  await page.getByRole('button', { name: 'Agent 能力', exact: true }).click()
  await page.getByTestId('confirm-yes').click()
  await page.getByText(/已有 Skill 与 MCP/).click()
  const fixture = page.locator('article').filter({ has: page.getByRole('heading', { name: 'fixture', exact: true }) })
  await fixture.getByRole('button', { name: '编辑为项目草稿', exact: true }).click()
  assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), 'fixture')
  await page.getByRole('button', { name: '保存新版本草稿', exact: true }).click()
  await page.getByRole('button', { name: '应用到项目', exact: true }).waitFor()
  await page.getByRole('button', { name: '应用到项目', exact: true }).click()
  await page.getByTestId('confirm-yes').click()
  await page.getByText('skill · active', { exact: true }).waitFor()
  await page.getByRole('button', { name: '项目概览', exact: true }).click()
  await page.getByRole('button', { name: '确认阶段', exact: true }).waitFor()
  response = await context.request.get(`${base}/api/projects/${project.id}/handoff`)
  assert.equal(response.status(), 200)
  const shared = await response.json()
  assert.equal(shared.executionEnabled, false)
  assert.equal(shared.sharedState.runs.length, 0, 'planning preview did not execute approval')
  assert.equal(shared.sharedState.capabilities[0].state, 'active')
  assert.equal(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'workflow fits phone')
  await page.getByTestId('projects-lang-en').click()
  await page.getByRole('button', { name: 'Plan board', exact: true }).click()
  assert.equal(await page.getByLabel('Project goal', { exact: true }).inputValue(), 'Goal at 390', 'language changes preserve the saved plan')
  assert.equal(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'English board fits phone')
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await page.getByRole('button', { name: 'Approve stage', exact: true }).click()
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel', exact: true }).waitFor()
  await page.getByTestId('confirm-no').click()
  if (mount) {
    const manifest = await (await context.request.get(base + '/manifest.webmanifest')).json()
    assert.equal(manifest.scope, mount + '/')
    await page.waitForFunction((prefix) => navigator.serviceWorker.getRegistration().then((r) => r?.scope.endsWith(prefix + '/')), mount)
    assert.equal(await page.evaluate(() => localStorage.getItem('vibepanel.theme')), 'light')
    const before = await context.cookies()
    assert.ok(before.some((c) => c.name.startsWith('vibepanel_session_') && c.path === mount + '/'))
    await context.request.post(base + '/api/auth/logout', { data: {} })
    assert.equal((await context.cookies()).find((c) => c.name === 'vibepanel_session')?.value, 'production-sentinel')
    assert.equal((await context.request.get(base + '/api/state')).status(), 401)
    const login = await context.request.post(base + '/api/auth/login', { data: { username: 'board-test', password: 'test-password-only-for-temporary-database' } })
    assert.equal(login.status(), 200)
    await page.goto(base + '/')
    await page.waitForFunction((prefix) => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === prefix + '/projects'), mount)
    const connected = page.waitForEvent('websocket').then(async (ws) => {
      await ws.waitForEvent('framereceived', { timeout: 10000 })
      return ws.url()
    })
    await page.reload()
    assert.equal(new URL(await connected).pathname, mount + '/ws')
    assert.deepEqual(escaped, [], 'all instance requests stay under the mount')
  }
  assert.deepEqual(errors, [])
  console.log(`=== ${mount ? 'basepath' : 'board'} check: 0 FAIL, 0 WARN; desktop/mobile bilingual drafts, approval/cancel, skill import, invalidation, handoff and isolation checked ===`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* empty server */ }
  rmSync(data, { recursive: true, force: true })
}
