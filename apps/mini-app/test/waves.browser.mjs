import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('all illustrations deform their paths, keep their placement and respect motion preferences', {
  skip: !process.env.WAVE_TEST_URL && 'Set WAVE_TEST_URL to a local Vite server', timeout:60_000,
}, async () => {
  const base = new URL(process.env.WAVE_TEST_URL);
  assert.ok(['127.0.0.1','localhost'].includes(base.hostname));
  const browser=await chromium.launch({channel:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'no-preference'});
    const errors=[];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(new URL('/test/waves.html',base).href);
    const profiles=['landscape','terrain','knowledge','playground','inbox','settings'];
    for(const profile of profiles) {
      const group=page.locator(`[data-wave-profile="${profile}"]`);
      await group.scrollIntoViewIfNeeded();
      await page.waitForFunction(p => document.querySelector(`[data-wave-profile="${p}"]`)?.getAttribute('data-wave-state')==='running',profile);
      const path=group.locator('path').first();
      const before=await path.getAttribute('d');
      const placement=await group.evaluate(g => {
        const svg=g.ownerSVGElement,r=svg.getBoundingClientRect();
        return {x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(svg).transform};
      });
      await page.waitForTimeout(650);
      const after=await path.getAttribute('d');
      assert.notEqual(after,before, `${profile}: geometry should move`);
      const a=before.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const b=after.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const displacements=a.filter((_,i)=>i%2).map((y,i)=>b[i*2+1]-y);
      assert.ok(Math.max(...displacements)-Math.min(...displacements)>1,`${profile}: wave must deform, not translate`);
      assert.deepEqual(await group.evaluate(g => {
        const svg=g.ownerSVGElement,r=svg.getBoundingClientRect();
        return {x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(svg).transform};
      }),placement);
    }
    await page.evaluate(() => scrollTo(0,document.body.scrollHeight));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-wave-state]')].every(g=>g.dataset.waveState==='paused'));
    const offscreen=await page.locator('[data-wave-profile="landscape"] path').first().getAttribute('d');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-wave-profile="landscape"] path').first().getAttribute('d'),offscreen);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(() => scrollTo(0,0));
    await page.waitForTimeout(100);
    const still=await page.locator('[data-wave-profile] path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')));
    await page.waitForTimeout(300);
    assert.deepEqual(await page.locator('[data-wave-profile] path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d'))),still);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(() => document.querySelector('[data-wave-profile="landscape"]')?.getAttribute('data-wave-state')==='running');
    if (process.env.WAVE_SCREENSHOT) await page.screenshot({path:process.env.WAVE_SCREENSHOT});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
