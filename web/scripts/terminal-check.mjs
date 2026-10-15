// Exercise the real TerminalView and xterm parser without production sessions.
// The transport fixture can delay size acknowledgements and deliver output and
// a resize in one task, as a socket does when a busy tab catches up.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

const port = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const base = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
vite.stdout.on('data', (data) => { log += data })
vite.stderr.on('data', (data) => { log += data })
let browser
const errors = []
try {
  let up = false
  for (let i = 0; i < 100; i++) {
    try { up = (await fetch(base)).ok } catch { /* not listening yet */ }
    if (up) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(up, `vite did not start: ${log}`)
  // The document is fulfilled by Playwright, so Chromium otherwise classifies
  // its local Vite websocket as a public-to-private request.
  browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', (error) => { errors.push(String(error)); console.error(String(error)) })
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()) })
  await page.route('**/terminal-check', (route) => route.fulfill({ contentType: 'text/html', body: `
    <html data-theme="dark"><body><div id="root" style="width:760px;height:400px"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      const { createElement: h } = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { TerminalView } = await import('/src/components/Terminal.tsx')
      const { liveTerminals } = await import('/src/components/terminals.ts')
      const { Terminal: Xterm } = await import('/node_modules/.vite/deps/@xterm_xterm.js')
      await import('/src/styles.css')
      localStorage.setItem('vibepanel.renderer', 'dom')
      const root = createRoot(document.querySelector('#root'))
      let handlers
      let owner = false
      let delay = 0
      const requests = []
      const socket = {
        subscribe(id, cols, rows, next) {
          handlers = next
          setTimeout(() => {
            handlers.onSubscribed({ replayBytes: 0, replayChunks: 0, resumed: false })
            handlers.onSize(120, 35, owner)
          }, 0)
        },
        unsubscribe() {}, setHidden() {}, reportLoadTiming() {}, write() {}, writeText() {},
        resize(id, cols, rows) {
          requests.push([cols, rows])
          if (owner) setTimeout(() => handlers.onSize(cols, rows, true), delay)
        },
      }
      const render = (hidden = false, fullscreen = false) => root.render(h(TerminalView, {
        socket, sessionId: 'fixture', themeKey: 'dark', hidden, fullscreen,
        className: hidden ? 'hidden h-full w-full' : 'h-full w-full',
      }))
      const snapshot = (term) => ({
        cols: term.cols, rows: term.rows,
        x: term.buffer.active.cursorX, y: term.buffer.active.cursorY,
        lines: Array.from({ length: term.buffer.active.length }, (_, i) =>
          term.buffer.active.getLine(i)?.translateToString(true)),
      })
      window.fixture = {
        render, requests,
        get term() { return liveTerminals.get('fixture') },
        get handlers() { return handlers },
        snapshot, Xterm,
        control(ms = 0) { owner = true; delay = ms; handlers.onSize(120, 35, true) },
      }
      render()
    </script></body></html>
  ` }))
  await page.goto(`${base}/terminal-check`)
  await page.waitForFunction(() => window.fixture?.term && !document.querySelector('[data-testid="terminal-load-progress"]'))
  await page.waitForTimeout(150)

  async function check(name, test) {
    try { await test(); console.log(`PASS ${name}`) }
    catch (error) { errors.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`) }
  }

  await check('passive viewers keep the server grid across hide/show', async () => {
    const initial = await page.evaluate(() => [fixture.term.cols, fixture.term.rows])
    assert.deepEqual(initial, [120, 35])
    await page.evaluate(() => fixture.render(true))
    await page.waitForTimeout(50)
    await page.evaluate(() => fixture.render(false))
    await page.waitForTimeout(100)
    assert.deepEqual(await page.evaluate(() => [fixture.term.cols, fixture.term.rows]), [120, 35])
    assert.deepEqual(await page.evaluate(() => fixture.requests), [])
  })

  await check('output preceding a size notification parses at the preceding size', async () => {
    const result = await page.evaluate(async () => {
      const { term, handlers, Xterm, snapshot } = fixture
      handlers.onSize(120, 35, false)
      await new Promise((resolve) => term.write('\x1bc', resolve))
      const reference = new Xterm({ cols: 120, rows: 35, allowProposedApi: true })
      const before = '\x1b[2J\x1b[1;120HX\x1b[10;100HY'
      const after = '\x1b[4;10HREADY'
      await new Promise((resolve) => reference.write(before, resolve))
      reference.resize(80, 24)
      await new Promise((resolve) => reference.write(after, resolve))
      handlers.onData(new TextEncoder().encode(before), false)
      handlers.onSize(80, 24, false)
      handlers.onData(new TextEncoder().encode(after), false)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const answer = { actual: snapshot(term), expected: snapshot(reference) }
      reference.dispose()
      return answer
    })
    assert.deepEqual(result.actual, result.expected)
  })

  await check('a delayed size acknowledgement does not resize the local grid early', async () => {
    await page.evaluate(() => fixture.control(150))
    await page.waitForTimeout(500)
    const result = await page.evaluate(async () => {
      const before = [fixture.term.cols, fixture.term.rows]
      document.querySelector('#root').style.width = '620px'
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { before, pending: [fixture.term.cols, fixture.term.rows] }
    })
    assert.deepEqual(result.pending, result.before)
    await page.waitForTimeout(350)
    const size = await page.evaluate(() => [fixture.term.cols, fixture.term.rows])
    assert.notDeepEqual(size, result.before)
  })

  await check('resize acknowledgements do not send duplicate requests', async () => {
    const result = await page.evaluate(async () => {
      fixture.requests.length = 0
      // Repeated notifications are normal when visibility and subscription
      // confirmations both report the current grid. None changes the box.
      for (let i = 0; i < 5; i++) {
        fixture.handlers.onSize(fixture.term.cols, fixture.term.rows, true)
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      return fixture.requests
    })
    assert.deepEqual(result, [])
  })

  // Entering a fullscreen program used to add right padding to .xterm, which
  // made the controlling viewer propose two fewer columns: a real tmux resize
  // and a full repaint every time Codex or vim opened. The paging control has
  // to fit in the gutter the normal grid already leaves.
  await check('a fullscreen program keeps the grid and its paging control clears the text', async () => {
    const result = await page.evaluate(async () => {
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      fixture.render(false, false)
      await frames()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const before = [fixture.term.cols, fixture.term.rows]
      fixture.requests.length = 0
      fixture.render(false, true)
      await frames()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const during = [fixture.term.cols, fixture.term.rows]
      const pager = document.querySelector('.vp-terminal-scroll')?.getBoundingClientRect()
      const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect()
      fixture.render(false, false)
      await frames()
      await new Promise((resolve) => setTimeout(resolve, 300))
      return {
        before, during, after: [fixture.term.cols, fixture.term.rows], requests: [...fixture.requests],
        pager: pager && { left: pager.left, width: pager.width }, textRight: screen?.right,
      }
    })
    assert.deepEqual(result.during, result.before)
    assert.deepEqual(result.after, result.before)
    assert.deepEqual(result.requests, [])
    assert.ok(result.pager && result.pager.width > 0, 'the paging control is shown in fullscreen')
    assert.ok(result.pager.left >= result.textRight - 0.5,
      `the paging control starts at ${result.pager.left}, inside text ending at ${result.textRight}`)
  })
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
assert.deepEqual(errors, [])
