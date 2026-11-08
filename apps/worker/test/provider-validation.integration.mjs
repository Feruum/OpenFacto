import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createDatabase } from '@openfacto/database';
import { providerPorts } from '../dist/provider.js';

test('invalid completions settle once, replay rejection, and retain token diagnostics', async () => {
  const db = createDatabase(process.env.DATABASE_URL), sql = db.client;
  const org = randomUUID(), event = randomUUID();
  const settings = { AI_COMBINED_PLANNING: '1', AI_CHAT_ENDPOINT: 'https://fixture.invalid/validation',
    AI_CHAT_MODEL: 'fixture', AI_VERIFY_MODEL: '', AI_REASONING_EFFORT: 'low', AI_THINKING_MODE: '', AI_PLATFORM_KEY: 'synthetic',
    AI_PLATFORM_DAILY_MICROS: '1000000000', AI_INPUT_MICROS_PER_1K: '2', AI_OUTPUT_MICROS_PER_1K: '4' };
  const saved = new Map(Object.keys(settings).map(k => [k, process.env[k]])), oldFetch = globalThis.fetch;
  const oldTimeout = AbortSignal.timeout;
  try {
    Object.assign(process.env, settings);
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Validation fixture')`;
    await sql`INSERT INTO events(id,organization_id,name) VALUES(${event},${org},'Validation fixture')`;
    for (const fixture of [
      { content: '{"supported":true}', finish: 'length', expected: 'invalid_finish' },
      { content: '{"supported":', finish: 'stop', expected: 'invalid_json' },
      { content: '{"supported":"true"}', finish: 'stop', expected: 'invalid_schema' },
      { content: '{"supported":false}', finish: 'stop', expected: 'ok' },
    ]) {
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.equal(body.reasoning_effort, 'low'); assert.equal(body.max_tokens, 1200);
        return Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 5 } },
          choices: [{ finish_reason: fixture.finish, message: { content: fixture.content } }] });
      };
      const input = { organizationId: org, eventId: event, traceId: randomUUID(), question: 'When?',
        language: 'en', mode: 'evaluation', activated: true, handoffEnabled: true, faqOnly: false, sources: [] };
      for (let replay = 0; replay < 2; replay++) {
        const ports = providerPorts(sql, input);
        if (fixture.expected === 'ok') assert.equal(await ports.verify(input, []), false);
        else await assert.rejects(ports.verify(input, []), /provider_unavailable/);
        assert.equal(ports.usage().costMicros, 3);
      }
      assert.equal(calls, 1);
      const [row] = await sql`SELECT status,cost_micros,result FROM ai_operations WHERE event_id=${event} ORDER BY created_at DESC LIMIT 1`;
      assert.equal(row.status, 'settled'); assert.equal(Number(row.cost_micros), 3);
      assert.equal(row.result.diagnostics.parseStatus, fixture.expected);
      assert.equal(row.result.diagnostics.reasoningTokens, 5);
      assert.equal(row.result.diagnostics.cachedTokens, 0);
      assert.equal(row.result.diagnostics.model, 'fixture');
    }
    // Rows created before diagnostics/effort support retain their original signature shape.
    delete process.env.AI_REASONING_EFFORT;
    let legacyCalls = 0, request;
    globalThis.fetch = async (_url, options) => {
      legacyCalls++; request = JSON.parse(options.body);
      return Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100 },
        choices: [{ finish_reason: 'stop', message: { content: '{"supported":false}' } }] });
    };
    const legacyInput = { organizationId: org, eventId: event, traceId: randomUUID(), question: 'Legacy?',
      language: 'en', mode: 'evaluation', activated: true, handoffEnabled: true, faqOnly: false, sources: [] };
    assert.equal(await providerPorts(sql, legacyInput).verify(legacyInput, []), false);
    const operationId = createHash('sha256').update(JSON.stringify([org,event,legacyInput.traceId,'verify'])).digest('hex');
    const signature = createHash('sha256').update(JSON.stringify([settings.AI_CHAT_ENDPOINT, settings.AI_CHAT_MODEL,
      2,4,'platform','synthetic',request.messages[0].content,request.messages[1].content])).digest('hex');
    const [legacy] = await sql`SELECT result FROM ai_operations WHERE id=${operationId}`;
    assert.equal(legacy.result.signature, signature);
    await sql`UPDATE ai_operations SET result=result-'diagnostics' WHERE id=${operationId}`;
    assert.equal(await providerPorts(sql, legacyInput).verify(legacyInput, []), false);
    assert.equal(legacyCalls, 1);

    // A corrupt/legacy settled row without cost is unknown, never Number(null) => 0.
    await sql`UPDATE ai_operations SET cost_micros=null WHERE id=${operationId}`;
    const missingCost = providerPorts(sql, legacyInput);
    await assert.rejects(missingCost.verify(legacyInput, []), /operation_uncertain/);
    assert.equal(missingCost.usage().costMicros, null);
    assert.equal(legacyCalls, 1);

    for (const failure of ['timeout', 'http', 'missing_usage']) {
      let calls = 0;
      const timeoutController = new AbortController(), timeoutLimits = [];
      if (failure === 'timeout') AbortSignal.timeout = milliseconds => {
        timeoutLimits.push(milliseconds);
        return timeoutController.signal;
      };
      try {
      globalThis.fetch = async (_url, options) => {
        calls++;
        if (failure === 'timeout') {
          assert.equal(options.signal, timeoutController.signal);
          return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
            queueMicrotask(() => timeoutController.abort(new DOMException('Synthetic deadline', 'TimeoutError')));
          });
        }
        if (failure === 'http') return new Response('', { status: 502 });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"supported":false}' } }] });
      };
      const uncertainInput = { ...legacyInput, traceId: randomUUID() };
      const first = providerPorts(sql, uncertainInput);
      await assert.rejects(first.verify(uncertainInput, []), /provider_unavailable/);
      assert.deepEqual(first.usage(), { paidOperations: 1, costMicros: null });
      const replay = providerPorts(sql, uncertainInput);
      await assert.rejects(replay.verify(uncertainInput, []), /operation_uncertain/);
      assert.equal(replay.usage().costMicros, null);
      assert.equal(calls, 1, 'Uncertain replay must not retry the provider');
      const id = createHash('sha256').update(JSON.stringify([org,event,uncertainInput.traceId,'verify'])).digest('hex');
      const [row] = await sql`SELECT status,cost_micros,result->>'failure' AS failure FROM ai_operations WHERE id=${id}`;
      assert.equal(row.status, 'uncertain'); assert.equal(row.cost_micros, null);
      if (failure === 'timeout') {
        assert.deepEqual(timeoutLimits, [40000], 'Only the initial request creates the provider deadline');
        assert.equal(timeoutController.signal.aborted, true);
        assert.equal(row.failure, 'timeout');
      }
      } finally { AbortSignal.timeout = oldTimeout; }
    }

    // Real reservation transaction, injected failures only in the two post-call
    // ledger writes. Neither a failed settlement nor its failed recovery can
    // establish a zero charge or permit the reserved operation to dispatch again.
    const brokenWrites = [];
    const brokenSql = (strings, ...values) => {
      const statement = strings.join('?');
      const update = statement.match(/UPDATE ai_operations SET status='(settled|uncertain)'/);
      if (update) {
        brokenWrites.push(update[1]);
        return Promise.reject(new Error('Synthetic ledger write failure'));
      }
      return sql(strings, ...values);
    };
    brokenSql.begin = sql.begin.bind(sql);
    let ledgerFailureCalls = 0;
    globalThis.fetch = async () => {
      ledgerFailureCalls++;
      return Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100 },
        choices: [{ finish_reason: 'stop', message: { content: '{"supported":false}' } }] });
    };
    const brokenInput = { ...legacyInput, traceId: randomUUID() };
    const brokenPorts = providerPorts(brokenSql, brokenInput);
    await assert.rejects(brokenPorts.verify(brokenInput, []), /Synthetic ledger write failure/);
    assert.deepEqual(brokenWrites, ['settled', 'uncertain']);
    assert.deepEqual(brokenPorts.usage(), { paidOperations: 1, costMicros: null });
    const brokenId = createHash('sha256').update(JSON.stringify([org,event,brokenInput.traceId,'verify'])).digest('hex');
    const [reserved] = await sql`SELECT status,cost_micros FROM ai_operations WHERE id=${brokenId}`;
    assert.deepEqual(reserved, { status: 'reserved', cost_micros: null });
    const brokenReplay = providerPorts(sql, brokenInput);
    await assert.rejects(brokenReplay.verify(brokenInput, []), /operation_uncertain/);
    assert.equal(brokenReplay.usage().costMicros, null);
    assert.equal(ledgerFailureCalls, 1, 'Failed ledger persistence must not cause another provider call');

    // Known earlier costs cannot turn a partially unknown request into a known subtotal.
    const mixedInput = { ...legacyInput, traceId: randomUUID() };
    const mixed = providerPorts(sql, mixedInput);
    globalThis.fetch = async () => Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100 },
      choices: [{ finish_reason: 'stop', message: { content: '{"supported":false}' } }] });
    assert.equal(await mixed.verify(mixedInput, []), false);
    assert.equal(mixed.usage().costMicros, 3);
    globalThis.fetch = async () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); };
    await assert.rejects(mixed.assess(mixedInput, []), /provider_unavailable/);
    assert.equal(mixed.usage().costMicros, null);
    // Even reading another known settled charge cannot clear the sticky uncertainty.
    assert.equal(await mixed.verify(mixedInput, []), false);
    assert.equal(mixed.usage().costMicros, null);

    const noCall = providerPorts(sql, { ...legacyInput, traceId: randomUUID() });
    process.env.AI_PLATFORM_DAILY_MICROS = '0';
    await assert.rejects(noCall.verify(legacyInput, []), /budget_exhausted/);
    assert.deepEqual(noCall.usage(), { paidOperations: 0, costMicros: 0 });
  } finally {
    globalThis.fetch = oldFetch;
    AbortSignal.timeout = oldTimeout;
    for (const [k,v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sql`DELETE FROM organizations WHERE id=${org}`; await db.close();
  }
});
