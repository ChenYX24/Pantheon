// The automatic rollover strip in a real browser: pending, countdown, cancel.
//
// The Go tests cover the state machine and the unit tests render the markup
// once, but nothing had ever *clicked* it. The path a person takes -- see the
// notice, watch the number fall, press Cancel -- only exists in a running page,
// and the first time anyone tried it the only session available was below the
// 30% floor and could not be made pending at all.
//
// The real component is mounted by Vite with `fetch` replaced, so there is no
// binary, no tmux and no session to disturb. What the server decides is the Go
// tests' business; what is measured here is what the page does with each state
// and exactly which request a button sends.
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
let step = 'start'
try {
  let up = false
  for (let i = 0; i < 100; i++) {
    try { up = (await fetch(base)).ok } catch { /* not listening yet */ }
    if (up) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(up, `vite did not start: ${log}`)
  browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', (error) => { errors.push(String(error)); console.error(String(error)) })
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()) })
  await page.route('**/rollover-check', (route) => route.fulfill({ contentType: 'text/html', body: `
    <html data-theme="dark"><body><div id="root" style="width:100%"></div>
    <script type="module">
      // Installed before the app's modules load: the api module binds fetch
      // when it is first called, and every call has to land here.
      const requests = []
      let reply = { status: 200, body: {}, delay: 0 }
      window.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
        if (reply.delay) await new Promise((resolve) => setTimeout(resolve, reply.delay))
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
      }
      import RefreshRuntime from '/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      const { createElement: h } = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { AutoRolloverStrip } = await import('/src/components/AutoRolloverStrip.tsx')
      const { HandoffButton } = await import('/src/components/HandoffButton.tsx')
      const { setLang } = await import('/src/i18n.ts')
      await import('/src/styles.css')
      const root = createRoot(document.querySelector('#root'))
      const committed = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.fixture = {
        requests,
        reply(next) { reply = { status: 200, body: {}, delay: 0, ...next } },
        lang(next) { setLang(next) },
        // Resolved only after React has committed. A render that is merely
        // scheduled lets the next assertion read the previous state's DOM, and
        // a check that passes on stale markup passes whatever the component
        // does. flushSync was tried first and the DOM was still the old one
        // when it returned (cause not established), so this waits for frames.
        async button(status, props = {}) { root.render(h(HandoffButton, { sessionId: 'fixture', status, ...props })); await committed() },
        async show(status, props = {}) { root.render(h(AutoRolloverStrip, { sessionId: 'fixture', status, ...props })); await committed() },
      }
    </script></body></html>
  ` }))

  const strip = page.locator('[data-testid=auto-rollover]')
  const buttons = () => strip.locator('button').allInnerTexts()
  const show = (status, props) => page.evaluate(([s, p]) => window.fixture.show(s, p), [status, props])
  const button = (status, props) => page.evaluate(([s, p]) => window.fixture.button(s, p), [status, props])
  const requests = () => page.evaluate(() => window.fixture.requests.slice())
  const reset = () => page.evaluate(() => {
    window.fixture.requests.length = 0
    window.fixture.reply({})
  })

  await page.goto(`${base}/rollover-check`)
  // Vite may discover a dependency on first load and reload the page once; the
  // route above fulfils the reload too, so waiting for the fixture is enough.
  await page.waitForFunction(() => window.fixture, null, { timeout: 60_000 })
  await page.evaluate(() => window.fixture.lang('en'))

  step = 'nothing to show'
  for (const status of [undefined, { state: 'ok', pct: 12 }, { state: 'cancelled', pct: 72 }]) {
    await show(status)
    assert.equal(await strip.count(), 0, `a ${status?.state ?? 'missing'} session must show no strip`)
  }

  step = 'pending: the notice and the three ways out'
  await show({ state: 'due', pct: 72 })
  await strip.waitFor()
  assert.match(await strip.innerText(), /72%.*After this turn finishes/s)
  assert.deepEqual(await buttons(), ['Hand off now', 'Later', 'Never for this session'])
  assert.equal(await strip.locator('svg.lucide-clock').count(), 1, 'pending is a clock, not only a colour')
  assert.equal(await strip.locator('svg.lucide-triangle-alert').count(), 0)

  step = 'pending: each button sends exactly its own action'
  for (const [label, action] of [['Hand off now', 'now'], ['Later', 'later'], ['Never for this session', 'never']]) {
    await reset()
    await strip.getByRole('button', { name: label }).click()
    await page.waitForFunction(() => window.fixture.requests.length > 0)
    assert.deepEqual(await requests(), [{ url: '/api/sessions/fixture/rollover/auto', method: 'POST', body: { action } }])
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=auto-rollover] button')].some((b) => b.disabled))
  }

  step = 'countdown: the number falls and holds at zero'
  await show({ state: 'countdown', pct: 72, endsAt: Date.now() + 2300 })
  assert.deepEqual(await buttons(), ['Cancel'], 'only Cancel while counting down; Hand off now would race the timer')
  const first = Number((await strip.innerText()).match(/(\d+) s/)[1])
  assert.ok(first >= 2 && first <= 3, `a 2.3 s countdown started at ${first}`)
  await page.waitForFunction(() => /Handing off… 0 s/.test(document.querySelector('[data-testid=auto-rollover]')?.textContent ?? ''), null, { timeout: 5000 })
  await page.waitForTimeout(600)
  assert.match(await strip.innerText(), /Handing off… 0 s/, 'past the end it waits for the server rather than going negative')

  step = 'countdown: Cancel sends cancel once, even when pressed twice'
  await reset()
  await page.evaluate(() => window.fixture.reply({ delay: 400 }))
  await show({ state: 'countdown', pct: 72, endsAt: Date.now() + 30_000 })
  const cancel = strip.getByRole('button', { name: 'Cancel' })
  await cancel.click()
  assert.equal(await cancel.isDisabled(), true, 'disabled while the request is in flight')
  await cancel.click({ force: true, trial: false }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[data-testid=auto-rollover] button:disabled'))
  assert.deepEqual(await requests(), [{ url: '/api/sessions/fixture/rollover/auto', method: 'POST', body: { action: 'cancel' } }])

  step = 'countdown: the keyboard reaches Cancel'
  await reset()
  await show({ state: 'countdown', pct: 72, endsAt: Date.now() + 30_000 })
  // Chromium resumes Tab from wherever the last click was, and the previous
  // step clicked the only button, so Tab from there leaves the page. A person
  // reaching for the keyboard has just looked at the notice; click its text.
  await strip.getByRole('status').click()
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160))
  assert.match(focused, /Cancel/, `Tab landed on: ${focused}`)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.fixture.requests.length === 1)

  step = 'a refused action says so and the buttons come back'
  await reset()
  await page.evaluate(() => window.fixture.reply({ status: 409, body: { error: 'not counting down' } }))
  await show({ state: 'countdown', pct: 72, endsAt: Date.now() + 30_000 })
  await strip.getByRole('button', { name: 'Cancel' }).click()
  await strip.getByRole('alert').waitFor()
  assert.match(await strip.getByRole('alert').innerText(), /not counting down/)
  assert.equal(await strip.getByRole('button', { name: 'Cancel' }).isDisabled(), false)

  step = 'a requested handoff: no percentage, no automatic-only buttons, Cancel sends cancel'
  await reset()
  await show({ state: 'due', pct: 8, reason: 'now' })
  assert.match(await strip.innerText(), /Handoff requested/)
  assert.deepEqual(await buttons(), ['Cancel'])
  await strip.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForFunction(() => window.fixture.requests.length === 1)
  assert.deepEqual(await requests(), [{ url: '/api/sessions/fixture/rollover/auto', method: 'POST', body: { action: 'cancel' } }])

  step = 'a waiting reason is shown, changes with the reason and leaves with it'
  for (const waiting of ['turn', 'draft', 'background', 'input', 'quiet']) {
    await show({ state: 'due', pct: 8, reason: 'now', waiting })
    const line = strip.locator('[data-testid=rollover-waiting]')
    assert.equal(await line.count(), 1, `no reason line for ${waiting}`)
    const text = await line.innerText()
    assert.ok(text.length > 10 && !text.includes('autoRollover.'), `${waiting}: ${text}`)
  }
  await show({ state: 'due', pct: 8, reason: 'now' })
  assert.equal(await strip.locator('[data-testid=rollover-waiting]').count(), 0, 'a session at the boundary still says it is waiting')

  step = 'the hand-off button: one press, one request, whatever the policy'
  await reset()
  const handoff = page.getByTestId('handoff-now')
  await button(undefined)
  assert.match(await handoff.innerText(), /Hand off/)
  await handoff.click()
  await page.waitForFunction(() => window.fixture.requests.length === 1)
  assert.deepEqual(await requests(), [{ url: '/api/sessions/fixture/rollover/auto', method: 'POST', body: { action: 'now' } }])
  // The request leaving is not the press finishing: the button stays disabled
  // until the response, and the next step must not read it in between.
  await page.waitForFunction(() => !document.querySelector('[data-testid=handoff-now]')?.disabled)

  step = 'the hand-off button: unavailable while a handoff is underway, exited or disconnected'
  for (const [status, props] of [
    [{ state: 'due', pct: 8, reason: 'now' }, {}], [{ state: 'countdown', pct: 8, endsAt: Date.now() + 9000 }, {}],
    [{ state: 'handing_off', pct: 8 }, {}], [undefined, { disabled: true }],
  ]) {
    await button(status, props)
    assert.equal(await handoff.isDisabled(), true, `still pressable for ${JSON.stringify([status?.state, props])}`)
  }
  for (const status of [undefined, { state: 'ok', pct: 8 }, { state: 'failed', pct: 8 }, { state: 'cancelled', pct: 8 }]) {
    await button(status)
    const why = await handoff.evaluate((b) => ({ disabled: b.disabled, html: b.outerHTML.slice(0, 120) }))
    assert.equal(why.disabled, false, `not pressable for ${status?.state}: ${JSON.stringify(why)}`)
  }

  step = 'the hand-off button: a refusal is reported and the button comes back'
  await reset()
  await page.evaluate(() => window.fixture.reply({ status: 409, body: { error: 'session is not eligible for automatic rollover' } }))
  await button(undefined)
  await handoff.click()
  await page.waitForFunction(() => window.fixture.requests.length === 1)
  await page.waitForFunction(() => !document.querySelector('[data-testid=handoff-now]')?.disabled)
  await reset()

  step = 'the hand-off button: reachable by keyboard, icon-only when compact still has a name'
  await button(undefined, { compact: true })
  assert.equal(await handoff.getAttribute('aria-label'), 'Hand off')
  assert.equal((await handoff.innerText()).trim(), '')
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'handoff-now')

  step = 'handing off: nothing to press'
  await show({ state: 'handing_off', pct: 72 })
  assert.deepEqual(await buttons(), [])
  assert.match(await strip.innerText(), /Saving the handoff/)

  step = 'failed: a different shape, not only a different colour'
  await show({ state: 'failed', pct: 72 })
  assert.equal(await strip.locator('svg.lucide-triangle-alert').count(), 1)
  assert.equal(await strip.locator('svg.lucide-clock').count(), 0)

  step = 'a dropped connection disables every button'
  await show({ state: 'due', pct: 72 }, { disconnected: true })
  assert.equal(await strip.locator('button:not(:disabled)').count(), 0)

  step = 'layout: both languages, both themes, three widths'
  for (const lang of ['en', 'zh']) {
    await page.evaluate((l) => window.fixture.lang(l), lang)
    for (const theme of ['dark', 'light']) {
      await page.evaluate((th) => { document.documentElement.dataset.theme = th }, theme)
      for (const width of [320, 768, 1200]) {
        await page.setViewportSize({ width, height: 800 })
        for (const status of [{ state: 'due', pct: 72 }, { state: 'due', pct: 8, reason: 'now', waiting: 'turn' }, { state: 'countdown', pct: 72, endsAt: Date.now() + 60_000 }]) {
          await show(status)
          const m = await strip.evaluate((el) => {
            const box = el.getBoundingClientRect()
            return {
              overflows: el.scrollWidth > el.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
              outside: [...el.querySelectorAll('button')].some((b) => {
                const r = b.getBoundingClientRect()
                return r.left < box.left - 1 || r.right > box.right + 1
              }),
              text: el.textContent,
            }
          })
          const where = `${lang}/${theme}/${width}px/${status.state}`
          assert.equal(m.overflows, false, `overflows at ${where}`)
          assert.equal(m.outside, false, `a button sticks out at ${where}`)
          assert.ok(!/[{}]/.test(m.text), `an unfilled placeholder at ${where}: ${m.text}`)
        }
      }
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 })

  assert.deepEqual(errors, [], 'the page threw')
  console.log('rollover-check: ok')
} catch (error) {
  console.error(`rollover-check failed at "${step}":`, error instanceof Error ? error.message : error)
  console.error(log.slice(-2000))
  process.exitCode = 1
} finally {
  await browser?.close()
  vite.kill()
}
