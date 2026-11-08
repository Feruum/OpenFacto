import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

const base = process.env.LANDING_TEST_URL
const screenshots = process.env.LANDING_SCREENSHOT_DIR
test('mobile workspace: navigation, three locales, source editor, touch controls and consistent art', {
  skip: !base && 'Set LANDING_TEST_URL to a local production preview', timeout: 120_000,
}, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    async function fits(label) {
      const overflow = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(overflow.content <= overflow.width, `${label}: page overflow ${JSON.stringify(overflow)}`)
      const clipped = await page.locator('input:not([type=checkbox]):not([type=radio]), textarea, select, .source-row, .page-intro button').evaluateAll(elements => elements.filter(el => {
        if (!el.checkVisibility()) return false
        const r = el.getBoundingClientRect()
        return r.left < -1 || r.right > innerWidth + 1
      }).map(el => el.outerHTML.slice(0, 160)))
      assert.deepEqual(clipped, [], `${label}: clipped controls`)
    }
    for (const width of [320, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 })
      for (const locale of ['ru', 'kk', 'en']) {
        await page.goto(new URL('/?view=overview', base).href)
        await page.locator('.event-banner').waitFor()
        await page.locator('.locale select').selectOption(locale)
        await fits(`${width}/${locale}/overview`)
        const palette = await page.locator('.event-banner').evaluate(el => getComputedStyle(el).backgroundColor)
        await page.locator('.mobile-menu').tap()
        assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'), 'true')
        await fits(`${width}/${locale}/menu`)
        await page.locator('#workspace-navigation nav button').nth(1).tap()
        await page.locator('.section-art--knowledge').waitFor()
        assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'), 'false')
        for (const view of ['knowledge', 'playground', 'inbox', 'settings']) {
          await page.goto(new URL(`/?view=${view}`, base).href)
          await page.locator(`.section-art--${view}`).waitFor()
          assert.equal(await page.locator('.section-art').evaluate(el => getComputedStyle(el).backgroundColor), palette)
          assert.equal(await page.locator('.section-art svg').evaluate(el => getComputedStyle(el).color), 'rgb(184, 213, 232)')
          await fits(`${width}/${locale}/${view}`)
          const tinyInputs = await page.locator('input:not([type=checkbox]):not([type=radio]), textarea, select').evaluateAll(elements => elements.filter(el => el.checkVisibility() && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.tagName))
          assert.deepEqual(tinyInputs, [], `${view}: inputs must not trigger iOS focus zoom`)
          if (screenshots && width === 390 && locale === 'ru') await page.screenshot({ path: `${screenshots}/mobile-${view}.png`, fullPage: true })
          if (view === 'knowledge') {
            await page.locator('.source-row').first().tap()
            await page.getByRole('dialog').waitFor()
            await fits(`${width}/${locale}/source-dialog`)
            const dialog = await page.getByRole('dialog').boundingBox()
            assert.ok(dialog && dialog.height <= 844 && dialog.x >= 0 && dialog.x + dialog.width <= width)
            await page.getByRole('dialog').locator('textarea').first().fill('Длинный текст для проверки узкой формы. '.repeat(15))
            await fits(`${width}/${locale}/filled-dialog`)
            if (screenshots && width === 390 && locale === 'ru') await page.screenshot({ path: `${screenshots}/mobile-source-dialog.png` })
            await page.getByRole('dialog').locator('.icon-button').tap()
            assert.equal(await page.getByRole('dialog').count(), 0)
          }
          if (view === 'playground' && width === 320) {
            await page.locator('.examples button').first().tap()
            await page.locator('.test-grid form button[type=submit]').tap()
            await page.locator('.result .response').waitFor()
            await fits(`${width}/${locale}/answer`)
            await page.locator('.evaluation > summary').tap()
            await page.locator('.evaluation .actions button').first().tap()
            await page.locator('.eval-case').waitFor()
            await fits(`${width}/${locale}/evaluation-form`)
          }
          if (view === 'inbox' && width === 320) {
            await page.locator('.ticket .text-button').first().tap()
            await page.locator('.ticket textarea').fill('Проверка формы ответа на узком экране.')
            await fits(`${width}/${locale}/reply-form`)
          }
        }
      }
    }
    for (const width of [320, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(new URL('/welcome', base).href)
      await page.locator('.landing-atlas').waitFor()
      await fits(`${width}/landing`)
      await page.getByRole('button', { name: 'Связи', exact: true }).tap()
      await page.getByRole('button', { name: 'Смешанная речь', exact: true }).tap()
      await fits(`${width}/landing-interaction`)
      if (width === 390 && screenshots) await page.screenshot({ path: `${screenshots}/mobile-landing-updated.png`, fullPage: true })
    }
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    await desktop.goto(new URL('/?view=knowledge', base).href)
    const row = desktop.locator('.source-row').first()
    await row.waitFor()
    const background = await row.evaluate(el => getComputedStyle(el).backgroundColor)
    await row.hover()
    assert.equal(await row.evaluate(el => getComputedStyle(el).backgroundColor), background, 'FAQ hover must not fill the row')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
