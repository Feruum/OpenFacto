import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('local workspace answers colloquial and mixed questions with context and citations', {
  skip: !process.env.LOCAL_BROWSER_TEST_URL && 'Set LOCAL_BROWSER_TEST_URL for the opt-in local AI workspace',
  timeout: 240_000,
}, async () => {
  const url = new URL(process.env.LOCAL_BROWSER_TEST_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url.href);
    await page.locator('.locale select').selectOption('en');
    await page.getByRole('navigation').getByRole('button', {name:'Playground',exact:true}).click();
    await page.locator('.field-pair select').first().selectOption('ru');
    const answer = page.locator('.response');
    const question = page.locator('textarea').first();
    async function ask(value) {
      await question.fill(value);
      await page.getByRole('button', { name:'Test an answer',exact:true }).click();
      await answer.waitFor({timeout:150_000});
      return answer.innerText();
    }
    assert.match(await ask('чо где проходит рега ?'), /фойе|главного зала/i);
    assert.ok(await page.locator('.citation').count());
    assert.match(await ask('а во ск?'), /09:00|9:00/);
    await page.getByRole('button', {name:'New conversation',exact:true}).click();
    assert.equal(await question.inputValue(), '');
    assert.equal(await answer.count(), 0);
    await page.locator('.field-pair select').first().selectOption('kk');
    assert.match(await ask('рега кайда болады?'), /тіркел|фойе|зал/i);
    assert.ok(await page.locator('.citation').count());
    await page.locator('.field-pair select').last().selectOption('draft_preview');
    assert.equal(await page.locator('summary').filter({hasText:'Conversation context'}).count(), 0);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
