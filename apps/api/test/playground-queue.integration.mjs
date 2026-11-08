import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '@openfacto/database';
import { ProductAccess } from '../dist/product/access.js';
import { digest } from '../dist/product/telegram-auth.js';
import * as api from '../dist/product/playground.js';

test('Playground durably enqueues, fences duplicate work, recovers leases and checks access at execution/read', async () => {
  assert.ok(process.env.DATABASE_URL);
  const db = createDatabase(process.env.DATABASE_URL), sql = db.client;
  const access = new ProductAccess(process.env.DATABASE_URL);
  const org = randomUUID(), event = randomUUID(), actor = randomUUID(), source = randomUUID(), version = randomUUID();
  const token = Buffer.alloc(32, 7).toString('base64url'), auth = 'Bearer ' + token;
  const scope = { org, event };
  try {
    await sql`INSERT INTO users(id,telegram_id,display_name) VALUES(${actor},${String(Date.now())},'Async fixture')`;
    await sql`INSERT INTO sessions(user_id,token_hash,init_hash,expires_at)
      VALUES(${actor},${digest(token)},${randomUUID()},now()+interval '1 hour')`;
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Async fixture')`;
    await sql`INSERT INTO memberships(organization_id,user_id,role) VALUES(${org},${actor},'owner')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Fixture','active')`;
    await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language)
      VALUES(${source},${org},${event},'faq','Where?','Main hall','en')`;
    await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,visibility,aliases)
      VALUES(${version},${org},${event},${source},1,'Where?','Main hall','en','participant','{}')`;
    await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
    const input = {requestId:randomUUID(),question:'Where?',language:'en'};
    const pending = await api.playground(access,auth,scope,input);
    assert.equal(pending.status,'pending');
    assert.equal(pending.requestId,input.requestId);
    assert.equal((await sql`SELECT 1 FROM answer_runs WHERE organization_id=${org}`).length,0);
    assert.deepEqual(await api.playground(access,auth,scope,input),pending);
    await sql`UPDATE events SET faq_only=true,handoff_enabled=false WHERE id=${event}`;
    assert.deepEqual(await api.playground(access,auth,scope,input),pending);
    await assert.rejects(api.playground(access,auth,scope,{...input,question:'When?'}),e=>e.getStatus()===409);
    await assert.rejects(api.playgroundStatus(access,auth,scope,randomUUID()),e=>e.getStatus()===404);
    const {processPlaygroundJob} = await import('../../worker/dist/playground-jobs.js');
    await Promise.all([processPlaygroundJob(sql,input.requestId),processPlaygroundJob(sql,input.requestId)]);
    const done = await api.playgroundStatus(access,auth,scope,input.requestId);
    assert.equal(done.status,'completed'); assert.equal(done.decision.answer,'Main hall');
    assert.equal(done.decision.delivery.requestId,input.requestId);
    assert.ok(done.decision.delivery.queueWaitMs >= 0);
    assert.ok(done.decision.delivery.workerDurationMs >= 0);
    assert.ok(Date.parse(done.decision.delivery.startedAt) >= Date.parse(done.decision.delivery.queuedAt));
    assert.ok(Date.parse(done.decision.delivery.answerReadyAt) >= Date.parse(done.decision.delivery.startedAt));
    assert.equal((await sql`SELECT 1 FROM answer_runs WHERE organization_id=${org}`).length,1);
    assert.deepEqual(await api.playground(access,auth,scope,input),done);
    const recovery = {...input,requestId:randomUUID()};
    await api.playground(access,auth,scope,recovery);
    await sql`UPDATE playground_requests SET status='running',attempts=1,available_at=now()-interval '1 minute' WHERE id=${recovery.requestId}`;
    await processPlaygroundJob(sql,recovery.requestId);
    assert.equal((await api.playgroundStatus(access,auth,scope,recovery.requestId)).status,'completed');
    const revoked = {...input,requestId:randomUUID()};
    await api.playground(access,auth,scope,revoked);
    await sql`UPDATE memberships SET role='viewer' WHERE organization_id=${org} AND user_id=${actor}`;
    await processPlaygroundJob(sql,revoked.requestId);
    const [denied] = await sql`SELECT status,error_code FROM playground_requests WHERE id=${revoked.requestId}`;
    assert.deepEqual(denied,{status:'failed',error_code:'access_changed'});
    await assert.rejects(api.playgroundStatus(access,auth,scope,input.requestId),e=>e.getStatus()===403);
    await sql`UPDATE memberships SET role='owner' WHERE organization_id=${org} AND user_id=${actor}`;
    await sql`UPDATE knowledge_sources SET published_version_id=null WHERE id=${source}`;
    await assert.rejects(api.playgroundStatus(access,auth,scope,input.requestId),e=>e.getStatus()===409);
  } finally {
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await sql`DELETE FROM users WHERE id=${actor}`;
    await access.database.close(); await db.close();
  }
});

test('semantic Playground retries and parallel jobs execute selection and verification exactly once', { timeout: 20_000 }, async () => {
  assert.ok(process.env.DATABASE_URL);
  const db = createDatabase(process.env.DATABASE_URL), sql = db.client;
  const access = new ProductAccess(process.env.DATABASE_URL);
  const org = randomUUID(), event = randomUUID(), actor = randomUUID(), source = randomUUID(), version = randomUUID();
  const auth = 'Bearer ' + randomBytes(32).toString('base64url'), scope = { org, event };
  const input = { requestId: randomUUID(), question: 'Where should I go to register for the event?', language: 'en',
    conversation: [{ question: 'Where is this event?', answer: 'The event takes place at Qadam Campus.' }] };
  const settings = {
    AI_CHAT_ENDPOINT: 'https://fixture.invalid/playground-idempotency',
    AI_CHAT_MODEL: 'gpt-6-luna', AI_REASONING_EFFORT: 'low', AI_PLATFORM_KEY: 'synthetic',
    AI_PLATFORM_DAILY_MICROS: '1000000000', AI_INPUT_MICROS_PER_1K: '1', AI_OUTPUT_MICROS_PER_1K: '1',
    AI_COMBINED_PLANNING: '1', AI_RESPONSE_CACHE: '1', EMBEDDING_URL: '', RERANK_URL: '',
  };
  const saved = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls = { selection: 0, verify: 0 };
  const unexpected = [];
  let releaseSelection, selectionStarted, activeJob;
  const gate = new Promise(resolve => { releaseSelection = resolve; });
  const started = new Promise(resolve => { selectionStarted = resolve; });
  const completion = value => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 10 },
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
  try {
    Object.assign(process.env, settings);
    // No request can reach a real provider, embedding service or reranker.
    globalThis.fetch = async (url, options) => {
      if (String(url) !== settings.AI_CHAT_ENDPOINT) {
        unexpected.push(String(url));
        throw new Error('Unexpected fixture request');
      }
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer synthetic');
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'gpt-6-luna');
      const payload = JSON.parse(request.messages.find(message => message.role === 'user').content);
      assert.equal(payload.question, input.question);
      if (Array.isArray(payload.candidates)) {
        calls.selection++;
        const candidate = payload.candidates.find(candidate => candidate.title === 'Where is registration?');
        assert.ok(candidate, 'Selection receives the published FAQ for the semantic paraphrase');
        selectionStarted();
        await gate;
        return completion({ kind: 'faq', index: candidate.index, responseLanguage: 'en', contextIndependent: true });
      }
      if (Array.isArray(payload.claims)) {
        calls.verify++;
        assert.equal(payload.claims.length, 1);
        assert.equal(payload.claims[0].approvedAnswer, 'Registration is in the main hall.');
        return completion({ supported: true });
      }
      unexpected.push('Unknown provider stage');
      throw new Error('Unexpected provider stage');
    };
    await sql`INSERT INTO users(id,telegram_id,display_name) VALUES(${actor},${String(Date.now())},'Semantic idempotency fixture')`;
    await sql`INSERT INTO sessions(user_id,token_hash,init_hash,expires_at)
      VALUES(${actor},${digest(auth.slice(7))},${randomUUID()},now()+interval '1 hour')`;
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Semantic idempotency fixture')`;
    await sql`INSERT INTO memberships(organization_id,user_id,role) VALUES(${org},${actor},'owner')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Semantic fixture','active')`;
    await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language)
      VALUES(${source},${org},${event},'faq','Where is registration?','Registration is in the main hall.','en')`;
    await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,visibility,aliases)
      VALUES(${version},${org},${event},${source},1,'Where is registration?','Registration is in the main hall.','en','participant','{}')`;
    await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;

    const [first, repeated] = await Promise.all([
      api.playground(access, auth, scope, input), api.playground(access, auth, scope, input),
    ]);
    assert.equal(first.status, 'pending');
    assert.deepEqual(repeated, first);
    assert.deepEqual(calls, { selection: 0, verify: 0 });
    await assert.rejects(api.playground(access, auth, scope, { ...input, question: 'When does registration close?' }),
      error => error.getStatus() === 409);

    const { processPlaygroundJob } = await import('../../worker/dist/playground-jobs.js');
    activeJob = processPlaygroundJob(sql, input.requestId);
    await Promise.race([started, activeJob.then(() => { throw new Error('Semantic selection was not reached'); })]);
    // Hold the first model call open while duplicate messages and a POST retry arrive.
    await Promise.all([processPlaygroundJob(sql, input.requestId), processPlaygroundJob(sql, input.requestId)]);
    assert.equal((await api.playground(access, auth, scope, input)).status, 'running');
    assert.deepEqual(calls, { selection: 1, verify: 0 });
    releaseSelection();
    await activeJob;

    const done = await api.playgroundStatus(access, auth, scope, input.requestId);
    assert.equal(done.status, 'completed');
    assert.equal(done.decision.outcome, 'approved_faq');
    assert.equal(done.decision.answer, 'Registration is in the main hall.');
    assert.equal(done.decision.usage.paidOperations, 2);
    assert.deepEqual(calls, { selection: 1, verify: 1 });
    assert.equal((await sql`SELECT 1 FROM answer_runs WHERE organization_id=${org}`).length, 1);
    const [job] = await sql`SELECT attempts FROM playground_requests WHERE id=${input.requestId}`;
    assert.equal(job.attempts, 1);
    const operations = await sql`SELECT status,result->'diagnostics'->>'stage' AS stage FROM ai_operations
      WHERE event_id=${event} ORDER BY stage`;
    assert.deepEqual([...operations], [{ status: 'settled', stage: 'select' }, { status: 'settled', stage: 'verify' }]);

    assert.deepEqual(await api.playground(access, auth, scope, input), done);
    await assert.rejects(api.playground(access, auth, scope, { ...input, question: 'When does registration close?' }),
      error => error.getStatus() === 409);
    await Promise.all([processPlaygroundJob(sql, input.requestId), processPlaygroundJob(sql, input.requestId)]);
    assert.deepEqual(await api.playgroundStatus(access, auth, scope, input.requestId), done);
    assert.deepEqual(calls, { selection: 1, verify: 1 }, 'Completed request replay adds no model calls');

    // A fresh user submission travels through the real API JSONB input and worker
    // claim; this also exercises PostgreSQL's normalization of nested key order.
    const repeatInput = { ...input, requestId: randomUUID(),
      conversation: [{ answer: input.conversation[0].answer, question: input.conversation[0].question }] };
    assert.equal((await api.playground(access, auth, scope, repeatInput)).status, 'pending');
    const [storedRepeat] = await sql`SELECT input FROM playground_requests WHERE id=${repeatInput.requestId}`;
    assert.deepEqual(storedRepeat.input.conversation, input.conversation);
    await processPlaygroundJob(sql, repeatInput.requestId);
    const cached = await api.playgroundStatus(access, auth, scope, repeatInput.requestId);
    assert.equal(cached.status, 'completed');
    assert.equal(cached.decision.answer, done.decision.answer);
    assert.equal(cached.decision.steps[0].stage, 'answer_cache');
    assert.deepEqual(cached.decision.usage, { paidOperations: 0, costMicros: 0 });
    assert.deepEqual(calls, { selection: 1, verify: 1 }, 'A queued repeat with identical full history adds no model calls');
    assert.notEqual(cached.decision.traceId, done.decision.traceId);
    assert.equal(cached.decision.delivery.requestId, repeatInput.requestId);
    assert.deepEqual(cached.decision.sources, done.decision.sources);
    assert.deepEqual(await api.playgroundStatus(access, auth, scope, input.requestId), done,
      'The cached result receives its own delivery metadata without mutating the original job');

    const changedHistory = { ...input, requestId: randomUUID(),
      conversation: [{ question: input.conversation[0].question, answer: 'Someone said the event moved elsewhere.' }] };
    assert.equal((await api.playground(access, auth, scope, changedHistory)).status, 'pending');
    await processPlaygroundJob(sql, changedHistory.requestId);
    const regenerated = await api.playgroundStatus(access, auth, scope, changedHistory.requestId);
    assert.equal(regenerated.status, 'completed');
    assert.equal(regenerated.decision.usage.paidOperations, 2);
    assert.deepEqual(calls, { selection: 2, verify: 2 }, 'A changed previous answer cannot reuse a cached decision');
    assert.equal((await sql`SELECT 1 FROM answer_runs WHERE organization_id=${org}`).length, 3);
    assert.equal((await sql`SELECT 1 FROM ai_operations WHERE event_id=${event}`).length, 4);
    assert.deepEqual(unexpected, []);
  } finally {
    releaseSelection();
    await activeJob?.catch(() => {});
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await sql`DELETE FROM users WHERE id=${actor}`;
    await access.database.close(); await db.close();
  }
});
