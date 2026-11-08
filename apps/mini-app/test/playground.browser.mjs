import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

test('Playground waits, resumes the same conversation and ignores stale scope results', {
  skip: !process.env.PLAYGROUND_TEST_URL && 'Set PLAYGROUND_TEST_URL to a loopback Vite dev server',
  timeout: 90_000,
}, async () => {
  const url = new URL(process.env.PLAYGROUND_TEST_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url.href)
    await page.evaluate(async () => {
      const { mount } = await import('/test/playground-harness.tsx')
      window.playgroundTest = mount()
    })
    const question = page.getByLabel('Participant question', { exact: true })
    const submit = page.getByRole('button', { name: 'Test an answer', exact: true })
    await question.fill('Where is check-in?')
    await submit.click()
    await page.getByText('Preparing your answer…', { exact: true }).waitFor()
    assert.equal(await question.isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'New conversation' }).isDisabled(), true)
    await page.evaluate(() => window.playgroundTest.finish())
    await page.locator('.response').getByText('Main hall', { exact: true }).waitFor()
    await page.waitForFunction(() => performance.getEntriesByName('openfacto.playground.send_to_render').length === 1)
    const measurements = await page.evaluate(() => performance.getEntriesByName('openfacto.playground.send_to_render').map(entry => ({
      duration: entry.duration, detail: entry.detail,
    })))
    assert.equal(measurements.length, 1)
    assert.ok(measurements[0].duration >= 0)
    assert.deepEqual(measurements[0].detail, {
      requestId: await page.evaluate(() => window.playgroundTest.calls[0].requestId), traceId: 'test',
    })

    await question.fill('And when?')
    await submit.click()
    await page.evaluate(() => window.playgroundTest.timeout())
    await page.getByRole('alert').filter({ hasText: 'Your answer has not arrived yet' }).waitFor()
    await page.clock.install()
    const recordedCount = await page.evaluate(() => performance.getEntriesByName('openfacto.playground.send_to_render').length)
    await page.clock.fastForward(11 * 60_000)
    await submit.click()
    const calls = await page.evaluate(() => window.playgroundTest.calls)
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[1], calls[2], 'Retry retains the same ID and context after its normal TTL')
    assert.equal(calls[2].conversation.length, 1)

    await page.evaluate(() => window.playgroundTest.changeEvent())
    await page.waitForFunction(() => window.playgroundTest.signals[2]?.aborted)
    await question.waitFor({ state: 'visible' })
    assert.equal(await question.inputValue(), '')
    assert.equal(await page.evaluate(() => window.playgroundTest.signals[2]?.aborted), true)
    await page.evaluate(() => window.playgroundTest.finish('Stale event answer'))
    assert.equal(await page.locator('.response').count(), 0)
    await question.fill('Question in new event')
    await submit.click()
    await page.evaluate(() => window.playgroundTest.changeLocale())
    await page.getByLabel('Вопрос участника', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.playgroundTest.signals[3]?.aborted), true)
    await page.evaluate(() => window.playgroundTest.finish('Stale locale answer'))
    assert.equal(await page.locator('.response').count(), 0)
    await page.getByLabel('Вопрос участника', { exact: true }).fill('Pending on unmount')
    await page.locator('button[type="submit"]').click()
    await page.evaluate(() => window.playgroundTest.unmount())
    assert.equal(await page.evaluate(() => window.playgroundTest.signals[4]?.aborted), true)
    await page.evaluate(() => window.playgroundTest.finish('Stale unmounted answer'))
    assert.equal(await page.evaluate(() => performance.getEntriesByName('openfacto.playground.send_to_render').length), recordedCount)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('Playground still renders when performance measurement is unavailable', {
  skip: !process.env.PLAYGROUND_TEST_URL && 'Set PLAYGROUND_TEST_URL to a loopback Vite dev server',
  timeout: 30_000,
}, async () => {
  const url = new URL(process.env.PLAYGROUND_TEST_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url.href)
    await page.evaluate(async () => {
      const measure = performance.measure.bind(performance)
      performance.measure = (...args) => {
        if (args[0] === 'openfacto.playground.send_to_render') throw new Error('Measurement unavailable')
        return measure(...args)
      }
      const { mount } = await import('/test/playground-harness.tsx')
      window.playgroundTest = mount()
    })
    await page.getByLabel('Participant question', { exact: true }).fill('Where is check-in?')
    await page.getByRole('button', { name: 'Test an answer', exact: true }).click()
    await page.evaluate(() => window.playgroundTest.finish())
    await page.locator('.response').getByText('Main hall', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
