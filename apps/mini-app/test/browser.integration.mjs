import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import test from 'node:test'
import { chromium } from 'playwright-core'

const { BROWSER_TEST_URL, BROWSER_TEST_MANAGER_TOKEN, BROWSER_TEST_CHROME } = process.env
const configured = Boolean(BROWSER_TEST_URL && BROWSER_TEST_MANAGER_TOKEN)
function launch(id) {
  const params = new URLSearchParams({
    user: JSON.stringify({ id, first_name: 'Organizer QA', language_code: 'en' }),
    query_id: randomUUID(),
    auth_date: String(Math.floor(Date.now() / 1000)),
  })
  const key = createHmac('sha256', 'WebAppData').update(BROWSER_TEST_MANAGER_TOKEN).digest()
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + '=' + v)
    .join('\n')
  params.set('hash', createHmac('sha256', key).update(check).digest('hex'))
  return new URLSearchParams({ tgWebAppData: params.toString() }).toString()
}

test(
  'organizer publishes an FAQ, inspects its evidence and evaluates it in a mobile-ready workspace',
  {
    skip: !configured && 'Set BROWSER_TEST_URL and BROWSER_TEST_MANAGER_TOKEN for the disposable stack',
    timeout: 150_000,
  },
  async () => {
    const url = new URL(BROWSER_TEST_URL)
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use a disposable loopback stack')
    const browser = await chromium.launch(
      BROWSER_TEST_CHROME ? { executablePath: BROWSER_TEST_CHROME } : { channel: 'chrome' },
    )
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      const identity = Date.now()
      url.hash = launch(identity)
      await page.goto(url.href)
      await page.getByLabel('Interface language').selectOption('en')
      const nav = (name) => page.getByRole('navigation').getByRole('button', { name, exact: true })
      async function create(label, value) {
        const input = page.getByLabel(label, { exact: true })
        await input.fill(value)
        await input
          .locator('xpath=ancestor::form')
          .getByRole('button', { name: 'Create', exact: true })
          .click()
      }
      await create('New organization', 'Organizer browser QA')
      await create('New event', 'Live browser event')
      await nav('Knowledge base').click()
      await page.getByRole('button', { name: 'Add source' }).click()
      const editor = page.getByRole('dialog')
      await editor.getByLabel('Title', { exact: true }).fill('Where is check-in?')
      await editor.getByLabel('Source text').fill('Check in at the main hall.')
      await editor.getByRole('combobox', { name: 'Language', exact: true }).selectOption('en')
      await editor.getByRole('button', { name: 'Save draft' }).click()
      await editor.getByRole('button', { name: 'Publish', exact: true }).click()
      await editor.getByText(/v1 · Where is check-in/).waitFor()
      await editor.getByRole('button', { name: 'Close', exact: true }).click()
      await nav('Playground').click()
      await page.getByRole('button', { name: 'Where is check-in?', exact: true }).click()
      const submitted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/playground'))
      await page.getByRole('button', { name: 'Test an answer' }).click()
      const submission = await submitted
      assert.equal(submission.status(), 202)
      const job = await submission.json()
      assert.ok(job.requestId)
      if (job.status !== 'completed') {
        const polled = page.waitForResponse((r) => r.request().method() === 'GET' && /\/playground\/[^/]+$/.test(new URL(r.url()).pathname))
        assert.equal(await page.getByLabel('Participant question', { exact: true }).isDisabled(), true)
        await page.getByText('Preparing your answer…', { exact: true }).waitFor()
        assert.equal((await polled).status(), 200)
      }
      await page.locator('.response').filter({ hasText: 'Check in at the main hall.' }).waitFor({ timeout: 90_000 })
      assert.equal(await page.getByLabel('Participant question', { exact: true }).isEnabled(), true)
      await page.getByText('Approved FAQ', { exact: true }).waitFor()
      await page.locator('.citation').getByRole('button', { name: 'Where is check-in?' }).click()
      await page.getByRole('dialog').getByText('Check in at the main hall.', { exact: true }).waitFor()
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
      await page.getByText('Evaluations', { exact: true }).click()
      await page.getByRole('button', { name: 'Add case' }).click()
      await page.getByRole('button', { name: 'Run suite' }).click()
      await page.getByRole('heading', { name: 'Completed', exact: true }).waitFor({ timeout: 90_000 })
      await page.getByText('Passed · Where is check-in?', { exact: true }).waitFor()
      // A second signed Telegram user joins this organization with analytics-only access.
      const reader = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      })
      reader.on('pageerror', (error) => errors.push(error.message))
      url.hash = launch(identity + 1)
      await reader.goto(url.href)
      await reader.getByLabel('New organization', { exact: true }).waitFor()
      await nav('Settings').click()
      await page.getByRole('button', { name: 'Team members', exact: true }).click()
      const memberForm = page.getByLabel('User Telegram ID').locator('xpath=ancestor::form')
      await memberForm.getByLabel('User Telegram ID').fill(String(identity + 1))
      await memberForm.getByRole('button', { name: 'Add member' }).click()
      await page.getByText('Organizer QA · Viewer', { exact: true }).waitFor()
      await reader.reload()
      await reader.getByRole('heading', { name: 'Live browser event', exact: true }).waitFor()
      const readerNavigation = reader.getByRole('navigation')
      assert.equal(await readerNavigation.getByRole('button', { name: 'Knowledge base' }).count(), 0)
      assert.equal(await readerNavigation.getByRole('button', { name: 'Handoffs' }).count(), 0)
      assert.equal(await readerNavigation.getByRole('button', { name: 'Playground' }).count(), 0)
      await reader.getByText('Answer activity', { exact: true }).click()
      const response = reader.waitForResponse((r) => new URL(r.url()).searchParams.get('days') === '7')
      await reader.getByLabel('Period in days', { exact: true }).selectOption('7')
      assert.equal((await response).status(), 200)
      await reader.close()
      await nav('Playground').click()
      await page.reload()
      await page.getByRole('heading', { name: 'Playground', exact: true }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Navigation', exact: true }).click()
      await nav('Overview').click()
      await page.getByRole('heading', { name: 'Live browser event', exact: true }).waitFor()
      await page.getByLabel('Interface language').selectOption('kk')
      await page.getByRole('heading', { name: 'Іс-шараға шолу' }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  },
)
