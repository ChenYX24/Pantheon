// Real server, SQLite, Git worktree and tmux; fixture executors never call a model provider.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { request } from 'playwright'
import { assertFreshBuild } from './lib/fresh.mjs'

assertFreshBuild(new URL('../../vibepanel', import.meta.url).pathname, new URL('../../', import.meta.url).pathname)

const data = mkdtempSync(join(tmpdir(), 'parthenon-workflow-'))
const repository = join(data, 'repository')
const fixtures = join(data, 'executors')
mkdirSync(repository); mkdirSync(fixtures)
execFileSync('git', ['init', '-q', repository])
writeFileSync(join(repository, 'README.md'), 'Temporary acceptance fixture\n')
execFileSync('git', ['-C', repository, 'add', 'README.md'])
execFileSync('git', ['-C', repository, '-c', 'user.name=Workflow check', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test fixture'])
const trace = join(data, 'invocations.txt')
const fixture = `#!/usr/bin/env python3
import json,os,sys,time
prompt=sys.stdin.read()
agent=os.path.basename(sys.argv[0])
review='Independently review' in prompt
with open(${JSON.stringify(trace)},'a') as out: out.write(agent+(' review' if review else ' write')+'\\n')
if agent=='codex' and not review: sys.exit(75)
if not review:
    time.sleep(6)
    with open('proof.txt','w') as out: out.write('acceptance fixture')
answer=json.dumps({'passed':True,'evidence':'proof.txt exists and the declared check passed'}) if review else 'Created proof.txt; ready for independent verification.'
if agent=='codex': print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':answer}}))
else: print(json.dumps({'result':answer,'is_error':False,'total_cost_usd':0.01}))
`
for (const name of ['claude', 'codex']) writeFileSync(join(fixtures, name), fixture, { mode: 0o700 })
const socket = `parthenon-workflow-${process.pid}`
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const base = `http://127.0.0.1:${port}`
let server
let log = ''
const start = () => {
  log = ''
  server = spawn(new URL('../../vibepanel', import.meta.url).pathname, ['serve', '--development', '--workflow-execute', '--addr', `127.0.0.1:${port}`, '--data-dir', join(data, 'state'), '--tmux-socket', socket, '--isolation', 'off'], { env: { ...process.env, PATH: `${fixtures}:${process.env.PATH}`, ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_AUTH_TOKEN: 'fixture-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (chunk) => { log += chunk })
  server.stderr.on('data', (chunk) => { log += chunk })
}
const stop = async () => {
  if (!server || server.exitCode !== null) return
  const exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exited
}
const waitFor = async (fn, description, limit = 30000) => {
  const end = Date.now() + limit
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result } catch { /* server restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out: ${description}`)
}
const client = await request.newContext()
try {
  start()
  const token = await waitFor(() => /one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(log)?.[1], 'initial setup')
  let response = await client.post(base + '/api/auth/setup', { data: { token, username: 'workflow', password: 'temporary-workflow-test-password' } })
  assert.equal(response.status(), 201)
  response = await client.post(base + '/api/projects', { data: { name: 'Workflow check', path: repository } })
  assert.equal(response.status(), 201)
  const project = await response.json()
  const route = `${base}/api/projects/${project.id}`
  response = await client.put(route + '/board', { data: { rev: 0, goal: 'Exercise durable execution', stages: [{ id: 'S1', title: 'Create evidence', primary: { harness: 'codex', model: 'fixture' }, secondary: { harness: 'claude', model: 'fixture' }, reason: 'Verify approved fallback', budgetMinutes: 2, attemptMinutes: 1, maxAttempts: 3 }], tasks: [{ id: 'T1', title: 'Create proof', phase: 'S1', status: 'ready', acceptance: 'proof.txt contains the fixture output', evidence: '', sessionId: '', owner: 'codex', dependsOn: [], verify: ['test -s proof.txt'] }] } })
  assert.equal(response.status(), 200)
  const board = await response.json()
  response = await client.post(route + '/stages/S1/approve', { data: { rev: board.rev } })
  assert.equal(response.status(), 200)
  await waitFor(() => existsSync(trace) && readFileSync(trace, 'utf8').includes('claude write'), 'fallback started')
  await stop()
  start()
  const view = await waitFor(async () => {
    const response = await client.get(route + '/workflow')
    if (!response.ok()) return null
    const value = await response.json()
    return value.runs.some((run) => run.state === 'done') && value
  }, 'worker receipt recovered after backend restart')
  assert.equal(view.runs.length, 1, 'restart did not duplicate the task')
  const run = view.runs[0]
  assert.equal(run.attempts, 2)
  assert.equal(run.switched, true)
  assert.equal(run.costUsd, 0.01)
  assert.notEqual(run.workspace, repository)
  assert.equal(existsSync(join(repository, 'proof.txt')), false, 'original checkout untouched')
  assert.equal(readFileSync(join(run.workspace, 'proof.txt'), 'utf8'), 'acceptance fixture')
  assert.deepEqual(readFileSync(trace, 'utf8').trim().split('\n'), ['codex write', 'claude write', 'codex review'])
  response = await client.get(route + '/board')
  const accepted = await response.json()
  assert.equal(accepted.tasks[0].status, 'done')
  assert.equal(accepted.tasks[0].sessionId, run.sessionId)
  console.log('=== workflow check: 0 FAIL, 0 WARN; real tmux/worktree, approved fallback, independent review and restart recovery checked ===')
} finally {
  await client.dispose()
  await stop()
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* no server */ }
  rmSync(data, { recursive: true, force: true })
}
