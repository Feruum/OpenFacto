import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

test('unknown costs render as a dash while zero and numeric historical costs remain readable', {
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
    await page.evaluate(async () => { (await import('/test/cost-harness.tsx')).mount() })
    for (const [index, expected] of ['—', '$0.00', '$0.00125'].entries()) {
      await page.getByLabel('Participant question', { exact: true }).fill(`Question ${index}`)
      await page.getByRole('button', { name: 'Test an answer', exact: true }).click()
      await page.locator('.response').getByText(`Answer ${index}`, { exact: true }).waitFor()
      await page.locator('.trace > summary').click()
      assert.match(await page.locator('.trace > p').nth(1).innerText(), new RegExp('Estimated cost · ' + expected.replace(/[$.]/g, '\\$&')))
      assert.deepEqual(await page.locator('.trace ol > li > small').allTextContents(), [
        '10 ms · — μUSD', '10 ms · 0 μUSD', '10 ms · 1250 μUSD', '10 ms · — μUSD',
      ])
    }
    await page.locator('.evaluation > summary').click()
    await page.getByLabel('Previous runs', { exact: true }).selectOption('cost-fixture')
    const rows = page.locator('.evaluation section.history > details')
    await rows.first().waitFor()
    for (const [index, expected] of ['—', '$0.00', '$0.00125'].entries()) {
      await rows.nth(index).locator('summary').click()
      assert.ok((await rows.nth(index).locator('p').innerText()).includes(`Estimated cost · ${expected}`))
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
