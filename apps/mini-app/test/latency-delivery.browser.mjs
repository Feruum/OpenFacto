import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Controlled delivery experiment: identical server-ready time, real browser/React
// and requestPlayground. No model calls. Do not interpret this as live AI latency.
const url = new URL(process.env.PLAYGROUND_TEST_URL || 'http://127.0.0.1:55173');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const readyMs of [2100, 4700, 15100]) for (const variant of ['old', 'new']) {
    const page = await browser.newPage();
    let readyAt, requestId, getCount = 0, active = 0, maxActive = 0;
    if (variant === 'old') await page.route('**/src/playground.ts*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const changed = source.replace(/\? 300 : (?:1000|1e3)/, '? 1500 : 1500');
      assert.ok(changed !== source, 'Old polling substitution must match compiled source');
      await route.fulfill({ response, body: changed });
    });
    await page.route('**/api/v1/latency-fixture/playground**', async route => {
      active++; maxActive = Math.max(maxActive, active);
      try {
        const request = route.request();
        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: {
            'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          }});
          return;
        }
        if (request.method() === 'POST') {
          requestId = request.postDataJSON().requestId;
          readyAt = Date.now() + readyMs;
        } else getCount++;
        const completed = Date.now() >= readyAt;
        await route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ requestId, status: completed ? 'completed' : 'pending',
            ...(completed ? { decision: { outcome: 'grounded_answer', reasonCode: 'document_evidence',
              answer: 'Verified fixture answer', sources: [], steps: [], durationMs: readyMs,
              traceId: 'controlled-delivery', usage: { paidOperations: 0, costMicros: 0 } } } : {}),
          }),
        });
      } finally { active--; }
    });
    await page.goto(url.href);
    await page.evaluate(async () => { const { mount } = await import('/test/latency-harness.tsx'); mount(); });
    await page.getByLabel('Participant question', { exact: true }).fill('Delivery fixture');
    await page.getByRole('button', { name: 'Test an answer', exact: true }).click();
    await page.waitForFunction(() => performance.getEntriesByName('openfacto.playground.send_to_render').length === 1, null, { timeout: 30000 });
    const measure = await page.evaluate(() => {
      const entry = performance.getEntriesByName('openfacto.playground.send_to_render')[0];
      return { durationMs: entry.duration, renderedAt: performance.timeOrigin + entry.startTime + entry.duration, detail: entry.detail };
    });
    assert.equal(measure.detail.requestId, requestId);
    assert.equal(maxActive, 1);
    if (variant === 'old') assert.ok(getCount <= Math.ceil(readyMs / 1500), 'Old schedule must really use 1500 ms polls');
    assert.equal(await page.locator('.response').getByText('Verified fixture answer', { exact: true }).count(), 1);
    results.push({ variant, serverReadyMs: readyMs, getCount, maxActive,
      sendToRenderMs: Math.round(measure.durationMs), deliveryDelayMs: Math.round(measure.renderedAt - readyAt) });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
  await mkdir('../../output/latency', { recursive: true });
  await writeFile('../../output/latency/browser-delivery.json', JSON.stringify({
    measurement: 'Controlled browser delivery only; intercepted HTTP and identical simulated server readiness, not live AI latency',
    measuredAt: new Date().toISOString(), results,
  }, null, 2));
} finally { await browser.close(); }
