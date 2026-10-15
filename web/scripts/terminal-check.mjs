// Exercise the real TerminalView and xterm parser without production sessions.
// The transport fixture can delay size acknowledgements and deliver output and
// a resize in one task, as a socket does when a busy tab catches up. Local echo
// uses delayed or absent server echoes, with the real buffer as the authority.
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
      const { setLocalEchoPreference } = await import('/src/components/localEchoPreference.ts')
      const { Terminal: Xterm } = await import('/node_modules/.vite/deps/@xterm_xterm.js')
      await import('/src/styles.css')
      localStorage.setItem('vibepanel.renderer', 'dom')
      setLocalEchoPreference('auto')
      const root = createRoot(document.querySelector('#root'))
      let handlers
      let owner = false
      let delay = 0
      let echoDelay = null
      const requests = []
      const writes = []
      const echoTimers = new Set()
      const latency = { rttMs: 300, jitterMs: 0, samples: 10 }
      const socket = {
        subscribe(id, cols, rows, next) {
          handlers = next
          setTimeout(() => {
            handlers.onSubscribed({ replayBytes: 0, replayChunks: 0, resumed: false })
            handlers.onSize(120, 35, owner)
          }, 0)
        },
        unsubscribe() {}, setHidden() {}, reportLoadTiming() {},
        getLatency() { return latency },
        onLatency(fn) { fn(latency); return () => {} },
        onStatus(fn) { fn('open'); return () => {} },
        write(id, data) {
          const bytes = new Uint8Array(data)
          writes.push(...bytes)
          if (echoDelay === null) return
          const timer = setTimeout(() => {
            echoTimers.delete(timer)
            handlers.onData(bytes, false)
          }, echoDelay)
          echoTimers.add(timer)
        },
        writeText(id, text) { this.write(id, new TextEncoder().encode(text)) },
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
        render, requests, writes, setLocalEchoPreference,
        get term() { return liveTerminals.get('fixture') },
        get handlers() { return handlers },
        snapshot, Xterm,
        echo(ms) { echoDelay = ms },
        output(text) {
          const term = liveTerminals.get('fixture')
          return new Promise((resolve) => {
            const sub = term.onWriteParsed(() => { sub.dispose(); resolve() })
            handlers.onData(new TextEncoder().encode(text), false)
          })
        },
        async prompt(text, ms = 300) {
          for (const timer of echoTimers) clearTimeout(timer)
          echoTimers.clear()
          echoDelay = ms
          await this.output('\\x1bc' + text)
          this.term.focus()
          writes.length = 0
        },
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

  const overlay = () => page.locator('[data-testid="local-echo-overlay"]')
  const sentBytes = () => page.evaluate(() => [...fixture.writes])
  const bytesOf = (text) => [...new TextEncoder().encode(text)]
  async function learnEcho() {
    await page.evaluate(() => fixture.prompt('$ '))
    await page.keyboard.type('a')
    assert.equal(await overlay().textContent(), '', 'the first character must be tracked silently')
    await page.waitForFunction(() => fixture.term.buffer.active.getLine(0)?.translateToString(true) === '$ a')
  }

  await check('300ms echo: prediction paints before the buffer changes, then disappears on confirmation', async () => {
    await learnEcho()
    await page.keyboard.type('b')
    const before = await page.evaluate(() => {
      const term = fixture.term
      const layer = document.querySelector('[data-testid="local-echo-overlay"]')
      const glyph = layer.firstElementChild
      const box = glyph?.getBoundingClientRect()
      const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect()
      const cell = term._core._renderService.dimensions.css.cell
      return {
        overlay: layer.textContent,
        buffer: term.buffer.active.getLine(0).translateToString(true),
        cell: term.buffer.active.getLine(0).getCell(3).getChars(),
        left: box && box.left - screen.left, top: box && box.top - screen.top,
        width: box?.width, expectedWidth: cell.width,
        style: glyph && { opacity: getComputedStyle(glyph).opacity, decoration: getComputedStyle(glyph).textDecorationLine },
      }
    })
    assert.equal(before.overlay, 'b')
    assert.equal(before.buffer, '$ a')
    assert.equal(before.cell, '')
    assert.ok(Math.abs(before.left - 3 * before.expectedWidth) < 0.1, 'prediction uses the fitted cell column')
    assert.ok(Math.abs(before.top) < 0.1, 'prediction uses the buffer row')
    assert.ok(Math.abs(before.width - before.expectedWidth) < 0.1)
    assert.ok(Number(before.style?.opacity) < 1)
    assert.ok(before.style?.decoration.includes('underline'))
    await page.waitForFunction(() => fixture.term.buffer.active.getLine(0)?.translateToString(true) === '$ ab'
      && document.querySelector('[data-testid="local-echo-overlay"]').textContent === '')
    assert.deepEqual(await sentBytes(), bytesOf('ab'))
  })

  await check('a non-echoing password prompt stays silent for multiple characters after a glitch', async () => {
    await learnEcho()
    await page.evaluate(() => fixture.echo(null))
    await page.keyboard.type('b')
    assert.equal(await overlay().textContent(), 'b')
    await page.evaluate(() => fixture.output('X'))
    assert.equal(await overlay().textContent(), '', 'a mismatched echo clears the whole prediction')
    await page.evaluate(() => fixture.output('\r\nPassword: '))
    await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="local-echo-overlay"]')
      fixture.exposed = []
      fixture.watch = new MutationObserver(() => {
        if (layer.textContent) fixture.exposed.push(layer.textContent)
      })
      fixture.watch.observe(layer, { subtree: true, childList: true, characterData: true })
    })
    await page.keyboard.type('s')
    assert.equal(await overlay().textContent(), '')
    await page.keyboard.type('e')
    assert.equal(await overlay().textContent(), '')
    await page.waitForTimeout(1_700)
    assert.deepEqual(await page.evaluate(() => {
      fixture.watch.disconnect()
      return fixture.exposed
    }), [])
    assert.equal(await overlay().textContent(), '')
    assert.equal(await page.evaluate(() => fixture.term.buffer.active.getLine(1).translateToString(true)), 'Password:')
    assert.deepEqual(await sentBytes(), bytesOf('abse'))
  })

  await check('Enter clears a displayed prediction immediately, without waiting for the echo', async () => {
    await learnEcho()
    await page.keyboard.type('b')
    assert.equal(await overlay().textContent(), 'b')
    await page.keyboard.press('Enter')
    assert.equal(await overlay().textContent(), '')
    assert.deepEqual(await sentBytes(), bytesOf('ab\r'))
  })

  await check('prediction never changes the bytes sent for typing, controls, wide text or paste', async () => {
    const input = ['q', 'w', '\x7f', '\t', '\x1b[D', '\r', '中', 'pasted text']
    await page.evaluate(() => fixture.prompt('$ ', null))
    await page.evaluate((pieces) => {
      for (const piece of pieces) fixture.term.input(piece, true)
    }, input)
    assert.deepEqual(await sentBytes(), bytesOf(input.join('')))
    assert.equal(await overlay().textContent(), '')
    assert.equal(await page.evaluate(() => fixture.term.buffer.active.getLine(0).translateToString(true)), '$')
  })

  await check('even a one-character browser paste clears prediction and is sent unchanged', async () => {
    await learnEcho()
    await page.evaluate(() => fixture.echo(null))
    await page.keyboard.type('b')
    assert.equal(await overlay().textContent(), 'b')
    await page.evaluate(() => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', 'p')
      fixture.term.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    })
    assert.equal(await overlay().textContent(), '')
    assert.deepEqual(await sentBytes(), bytesOf('abp'))
  })

  await check('composition and its deferred commit stay silent without changing input', async () => {
    await learnEcho()
    await page.evaluate(() => {
      fixture.echo(null)
      fixture.term.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      fixture.term.input('c', true)
      fixture.term.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      fixture.term.input('e', true)
    })
    assert.equal(await overlay().textContent(), '')
    assert.deepEqual(await sentBytes(), bytesOf('ace'))
  })

  await check('tmux fullscreen status disables prediction even while xterm stays in its normal buffer', async () => {
    await learnEcho()
    await page.evaluate(() => fixture.echo(null))
    await page.keyboard.type('b')
    assert.equal(await overlay().textContent(), 'b')
    await page.evaluate(() => fixture.render(false, true))
    await page.waitForFunction(() => document.querySelector('[data-session-id="fixture"]').dataset.fullscreen === 'true'
      && document.querySelector('[data-testid="local-echo-overlay"]').textContent === '')
    await page.keyboard.type('c')
    assert.equal(await overlay().textContent(), '')
    assert.equal(await page.evaluate(() => fixture.term.buffer.active.type), 'normal')
    assert.deepEqual(await sentBytes(), bytesOf('abc'))
    await page.evaluate(() => fixture.render(false, false))
    await page.waitForFunction(() => !document.querySelector('[data-session-id="fixture"]').dataset.fullscreen)
  })

  await check('the per-browser switch applies without remounting the terminal', async () => {
    await learnEcho()
    await page.evaluate(() => fixture.echo(null))
    await page.keyboard.type('b')
    assert.equal(await overlay().textContent(), 'b')
    await page.evaluate(() => {
      fixture.beforePreference = fixture.term
      fixture.setLocalEchoPreference('off')
    })
    assert.equal(await overlay().textContent(), '')
    await page.keyboard.type('c')
    assert.equal(await overlay().textContent(), '')
    assert.equal(await page.evaluate(() => fixture.term === fixture.beforePreference), true)
    assert.deepEqual(await sentBytes(), bytesOf('abc'))
    await page.evaluate(() => fixture.setLocalEchoPreference('auto'))
  })
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
assert.deepEqual(errors, [])
