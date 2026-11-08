import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase, encryptBotToken } from '@openfacto/database';
import { runScopedAnswer } from '../dist/answers.js';
import { processUpdate, deliver } from '../dist/telegram.js';
import { providerPorts } from '../dist/provider.js';

test('published FAQ → durable Telegram decision → scope check before delivery', async () => {
  const db = createDatabase(process.env.DATABASE_URL);
  const sql = db.client;
  const org = randomUUID(),
    event = randomUUID(),
    bot = randomUUID(),
    source = randomUUID(),
    version = randomUUID(),
    inbox = randomUUID();
  const originalKey = process.env.BOT_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  const aiSettings = { AI_CHAT_ENDPOINT: 'https://fixture.invalid/language', AI_CHAT_MODEL: 'fixture', AI_PLATFORM_KEY: 'synthetic', AI_PLATFORM_DAILY_MICROS: '1000000000', AI_INPUT_MICROS_PER_1K: '1', AI_OUTPUT_MICROS_PER_1K: '1' };
  const savedAi = new Map(Object.keys(aiSettings).map(k => [k, process.env[k]]));
  const key = Buffer.alloc(32, 7).toString('base64');
  try {
    process.env.BOT_ENCRYPTION_KEY = key;
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'isolated answer test')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Demo','active')`;
    await sql`INSERT INTO telegram_bots(id,organization_id,event_id,name,telegram_bot_id,username,token_ciphertext,webhook_secret_hash)
      VALUES(${bot},${org},${event},'test',${bot},'fixture_bot',${encryptBotToken('test-token', key, bot)},'fixture')`;
    await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body) VALUES(${source},${org},${event},'faq','Deadline?','12 May')`;
    await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility)
      VALUES(${version},${org},${event},${source},1,'Deadline?','12 May','en',ARRAY['When?'],'participant')`;
    await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
    const preview = {
      organizationId: org,
      eventId: event,
      question: 'When?',
      language: 'en',
      mode: 'published_preview',
      traceId: randomUUID(),
      activated: true,
      handoffEnabled: true,
      faqOnly: false,
    };
    const decision = await runScopedAnswer(sql, preview);
    assert.equal(decision.answer, '12 May');
    assert.equal(decision.usage.paidOperations, 0);
    Object.assign(process.env, aiSettings);
    globalThis.fetch = async () => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ queries: ['When?'], responseLanguage: 'en' }) } }] });
    const payload = {
      message: { chat: { id: 123, type: 'private' }, from: { id: 123, language_code: 'en' }, text: 'When?' },
    };
    await sql`INSERT INTO telegram_inbox(id,organization_id,event_id,bot_id,update_id,payload)
      VALUES(${inbox},${org},${event},${bot},'12',${sql.json(payload)})`;
    await Promise.all([processUpdate(sql, inbox), processUpdate(sql, inbox)]);
    const queued = await sql`SELECT * FROM telegram_outbox WHERE organization_id=${org}`;
    assert.equal(queued.length, 1);
    assert.equal(queued[0].body, '12 May\n\nSource: FAQ — Deadline?');
    assert.equal((await sql`SELECT id FROM answer_runs WHERE organization_id=${org}`).length, 1);
    let sends = 0;
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ ok: true });
    };
    await sql`UPDATE knowledge_sources SET published_version_id=NULL WHERE id=${source}`;
    await deliver(sql, queued[0].id);
    assert.equal(sends, 0);
    assert.equal((await sql`SELECT status FROM telegram_outbox WHERE id=${queued[0].id}`)[0].status, 'failed');
    const sendId = randomUUID();
    await sql`INSERT INTO telegram_outbox(id,organization_id,event_id,bot_id,chat_id,body,dedupe_key)
      VALUES(${sendId},${org},${event},${bot},'123','Moderator reply','test-delivery')`;
    process.env.BOT_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    await deliver(sql, sendId);
    const [deferred] = await sql`SELECT status,attempts,available_at>now() AS delayed FROM telegram_outbox WHERE id=${sendId}`;
    assert.deepEqual([deferred.status,deferred.attempts,deferred.delayed,sends], ['pending',1,true,0]);
    process.env.BOT_ENCRYPTION_KEY = key;
    await deliver(sql, sendId);
    assert.equal(sends,0,'other workers respect the retry delay');
    await sql`UPDATE telegram_outbox SET available_at=now() WHERE id=${sendId}`;
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ ok: false, parameters: { retry_after: 3 } }, { status: 429 });
    };
    await deliver(sql, sendId);
    assert.equal((await sql`SELECT status FROM telegram_outbox WHERE id=${sendId}`)[0].status, 'pending');
    await sql`UPDATE telegram_outbox SET available_at=now() WHERE id=${sendId}`;
    globalThis.fetch = async () => {
      sends++;
      throw new Error('Connection lost after dispatch');
    };
    await deliver(sql, sendId);
    await deliver(sql, sendId);
    assert.equal(sends, 2);
    assert.equal((await sql`SELECT status FROM telegram_outbox WHERE id=${sendId}`)[0].status, 'uncertain');
    const [next] = await sql`INSERT INTO telegram_outbox(organization_id,event_id,bot_id,chat_id,body,dedupe_key)
      VALUES(${org},${event},${bot},'123','Second reply','test-recovery') RETURNING id`;
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ok:true});
    };
    await Promise.all([deliver(sql,next.id),deliver(sql,next.id)]);
    assert.equal(sends,3,'two workers send the reply once');
    assert.equal((await sql`SELECT status FROM telegram_outbox WHERE id=${next.id}`)[0].status,'sent');

    const [last] = await sql`INSERT INTO telegram_outbox(organization_id,event_id,bot_id,chat_id,body,dedupe_key,attempts)
      VALUES(${org},${event},${bot},'123','Unsent reply','test-exhausted',4) RETURNING id`;
    const [contextBefore]=await sql`SELECT question FROM clarification_context WHERE bot_id=${bot} AND user_id='123'`;
    const greeting=randomUUID();
    await sql`INSERT INTO telegram_inbox(id,organization_id,event_id,bot_id,update_id,payload)
      VALUES(${greeting},${org},${event},${bot},'social',${sql.json({message:{chat:{id:123,type:'private'},from:{id:123,language_code:'ru'},text:'как дела'}})})`;
    await processUpdate(sql,greeting);
    const [social]=await sql`SELECT body,source_refs FROM telegram_outbox WHERE dedupe_key=${'answer/'+greeting+'/0'}`;
    assert.match(social.body,/Привет! Я на связи/);assert.deepEqual(social.source_refs,[]);
    assert.equal((await sql`SELECT question FROM clarification_context WHERE bot_id=${bot} AND user_id='123'`)[0].question,contextBefore.question);
    assert.equal(sends,3,'social replies do not use an AI provider or send a message before the delivery worker');
    delete process.env.BOT_ENCRYPTION_KEY;
    await deliver(sql,last.id);
    assert.equal((await sql`SELECT status FROM telegram_outbox WHERE id=${last.id}`)[0].status,'failed');
    assert.equal(sends,3);
  } finally {
    for (const [k, v] of savedAi) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (originalKey === undefined) delete process.env.BOT_ENCRYPTION_KEY;
    else process.env.BOT_ENCRYPTION_KEY = originalKey;
    globalThis.fetch = originalFetch;
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await db.close();
  }
});

test('concurrent paid operations cannot spend the same reserve twice', async () => {
  const db = createDatabase(process.env.DATABASE_URL);
  const sql = db.client;
  const org = randomUUID(),
    event = randomUUID();
  const settings = {
    AI_PLATFORM_KEY: 'synthetic',
    AI_PLATFORM_DAILY_MICROS: '100000',
    AI_INPUT_MICROS_PER_1K: '1',
    AI_OUTPUT_MICROS_PER_1K: '10',
    AI_CHAT_ENDPOINT: 'https://fixture.invalid/model',
    AI_CHAT_MODEL: 'fixture',
  };
  const saved = new Map(Object.keys(settings).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let calls = 0,
    allow;
  const gate = new Promise((resolve) => {
    allow = resolve;
  });
  let started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  try {
    Object.assign(process.env, settings);
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'budget test')`;
    await sql`INSERT INTO events(id,organization_id,name) VALUES(${event},${org},'Demo')`;
    await sql`INSERT INTO event_ai_settings(organization_id,event_id,daily_limit_micros) VALUES(${org},${event},20)`;
    globalThis.fetch = async () => {
      calls++;
      started();
      await gate;
      return Response.json({
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        choices: [{ finish_reason: 'stop', message: { content: '{"kind":"personal","responseLanguage":"ru"}' } }],
      });
    };
    const input = {
      organizationId: org,
      eventId: event,
      traceId: randomUUID(),
      question: 'Exception?',
      language: 'en',
      mode: 'live',
      activated: true,
      handoffEnabled: true,
      faqOnly: false,
      sources: [],
    };
    const ports = providerPorts(sql, input);
    const pending = ports.assess(input, []);
    await Promise.race([
      waiting,
      pending.then(() => {
        throw Error('Provider double was unreachable');
      }),
    ]);
    await assert.rejects(providerPorts(sql, input).assess(input, []), /operation_uncertain/);
    const other = { ...input, traceId: randomUUID() };
    await assert.rejects(providerPorts(sql, other).assess(other, []), /budget_exhausted/);
    allow();
    assert.deepEqual(await pending, { kind: 'personal', responseLanguage: 'ru' });
    assert.deepEqual(await providerPorts(sql, input).assess(input, []), { kind: 'personal', responseLanguage: 'ru' });
    // A replay against changed knowledge never interprets the original model's indices.
    await assert.rejects(
      providerPorts(sql, input).assess({ ...input, question: 'changed' }, []),
      /operation_uncertain/,
    );
    assert.equal(calls, 1);
  } finally {
    allow();
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await db.close();
  }
});
