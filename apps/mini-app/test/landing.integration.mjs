import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

const base = process.env.LANDING_TEST_URL
test('landing illustrations, evidence, application navigation and mobile layout', {
  skip: !base && 'Set LANDING_TEST_URL to a local preview server', timeout: 60_000,
}, async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL('/welcome', base).href)
    await page.getByRole('heading', { level: 1 }).waitFor()
    const path = page.locator('.landing-atlas-art path').first()
    const initial = await path.getAttribute('d')
    await page.getByRole('slider', { name: 'Высота рельефа' }).focus()
    await page.keyboard.press('ArrowRight')
    assert.notEqual(await path.getAttribute('d'), initial, 'Keyboard changes terrain geometry')
    await page.getByRole('button', { name: 'Диалог', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Диалог', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('slider').count(), 0)
    await page.getByRole('button', { name: 'Связи', exact: true }).click()
    assert.equal(await page.locator('.landing-atlas-art circle').count(), 2)
    await page.getByRole('button', { name: /Оставайтесь рядом/ }).click()
    assert.ok(await page.locator('.landing-process-art--inbox').isVisible())
    for (const name of ['Қазақша', 'Смешанная речь', 'Нет в источниках', 'Русский']) {
      await page.getByRole('button', { name, exact: true }).click()
      assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true')
      await page.locator('.landing-evidence summary').click()
      assert.ok(await page.locator('.landing-evidence p').isVisible())
    }
    await page.getByRole('button', { name: 'Рельеф', exact: true }).click()
    await page.getByRole('button', { name: /Соберите знания/ }).click()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.locator('.landing-atlas').scrollIntoViewIfNeeded()
    const atlas = await page.locator('.landing-atlas').boundingBox()
    assert.ok(atlas)
    await page.mouse.move(atlas.x + atlas.width * 0.8, atlas.y + atlas.height * 0.4)
    assert.notEqual(await page.locator('.landing-atlas-art').evaluate(el => el.style.getPropertyValue('--art-x')), '')
    await page.mouse.move(0, 0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (process.env.LANDING_SCREENSHOT_DIR) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `${process.env.LANDING_SCREENSHOT_DIR}/openfacto-landing-hero.png` })
      await page.screenshot({ path: `${process.env.LANDING_SCREENSHOT_DIR}/openfacto-landing-desktop.png`, fullPage: true })
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No landing overflow at ${width}px`)
    }
    if (process.env.LANDING_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: `${process.env.LANDING_SCREENSHOT_DIR}/openfacto-landing-mobile.png`, fullPage: true })
    }
    await page.getByRole('link', { name: 'Открыть Openfacto' }).click()
    await page.locator('.event-banner').waitFor()
    for (const kind of ['knowledge', 'playground', 'inbox', 'settings']) {
      await page.goto(new URL(`/?view=${kind}`, base).href)
      await page.locator(`.section-art--${kind}`).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No ${kind} overflow on mobile`)
      if (process.env.LANDING_SCREENSHOT_DIR && kind === 'knowledge') {
        await page.setViewportSize({ width: 1440, height: 1050 })
        await page.screenshot({ path: `${process.env.LANDING_SCREENSHOT_DIR}/openfacto-knowledge-art.png` })
        await page.setViewportSize({ width: 390, height: 844 })
      }
    }
    await page.getByRole('link', { name: 'О продукте' }).click()
    await page.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/welcome')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
