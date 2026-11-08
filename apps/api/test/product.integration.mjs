import 'reflect-metadata';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@openfacto/database';
import { createLogger } from '@openfacto/logger';
import { AppModule } from '../dist/app.module.js';
import { configureHttp } from '../dist/http.js';
import { processPlaygroundJob } from '@openfacto/worker/playground-jobs';

function launch(id, token) {
  const q = new URLSearchParams({
    user: JSON.stringify({ id, first_name: 'Organizer' }),
    query_id: randomUUID(),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const check = [...q]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + '=' + v)
    .join('\n');
  q.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return q.toString();
}
test('authenticated product routes enforce publication, scope and membership across SQL transactions', async () => {
  assert.ok(process.env.DATABASE_URL, 'migrated PostgreSQL required');
  const manager = randomBytes(32).toString('hex');
  process.env.MANAGER_BOT_TOKEN = manager;
  process.env.BOT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PUBLIC_WEBHOOK_ORIGIN = 'https://fixture.invalid';
  const botIdentity = Date.now();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    String(url).startsWith('https://api.telegram.org/')
      ? Promise.resolve(Response.json({ ok: true, result: { is_bot: true, id: botIdentity, username: 'fixture_bot' } }))
      : originalFetch(url, options);
  // Integration never contacts a paid provider.
  delete process.env.AI_CHAT_ENDPOINT;
  const db = createDatabase(process.env.DATABASE_URL);
  const app = await NestFactory.create(
    AppModule.register({
      databaseUrl: process.env.DATABASE_URL,
      rabbitmqUrl: process.env.RABBITMQ_URL,
      dependencyTimeoutMs: 1000,
    }),
    { logger: false },
  );
  const orgs = [],
    users = [];
  try {
    await configureHttp(
      app,
      'http://localhost:5173',
      createLogger('test', 'error', () => {}),
    );
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const call = async (method, path, token, body, expected = 200) => {
      const r = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = r.status === 204 ? null : await r.json();
      const queued = method === 'POST' && path.endsWith('/playground') && expected === 200;
      assert.equal(r.status, queued ? 202 : expected, method + ' ' + path + ' ' + JSON.stringify(data));
      if (queued) {
        await processPlaygroundJob(db.client,data.requestId);
        const result = await call('GET',path + '/' + data.requestId,token);
        assert.equal(result.status,'completed');
        return result.decision;
      }
      return data;
    };
    const auth = '/api/v1/auth/telegram',
      root = '/api/v1/organizations';
    const identityA = Date.now() * 10,
      identityB = identityA + 1;
    const initData = launch(identityA, manager),
      owner = await call('POST', auth, null, { initData });
    users.push(owner.user.id);
    await call('POST', auth, null, { initData }, 401);
    const other = await call('POST', auth, null, { initData: launch(identityB, manager) });
    users.push(other.user.id);
    await call('GET', root, null, undefined, 401);
    const a = await call('POST', root, owner.token, { name: 'One' }, 201);
    orgs.push(a.id);
    const b = await call('POST', root, other.token, { name: 'Two' }, 201);
    orgs.push(b.id);
    const ev = await call('POST', root + '/' + a.id + '/events', owner.token, { name: 'Conference' }, 201);
    const event = root + '/' + a.id + '/events/' + ev.id;
    await call('GET', event + '/sources', other.token, undefined, 404);
    await call('GET', root + '/' + b.id + '/events/' + ev.id + '/sources', other.token, undefined, 404);
    const member = await call(
      'POST',
      root + '/' + a.id + '/memberships',
      owner.token,
      { telegramId: String(identityB), role: 'viewer' },
      201,
    );
    await call('GET', event + '/sources', other.token, undefined, 403);
    await call('GET', event + '/analytics', other.token);
    for (const [outcome, reasonCode, durationMs, age] of [
      ['approved_faq', 'exact_faq', 10, 0],
      ['handoff', 'insufficient_evidence', 110, 0],
      ['refuse', 'private fixture text', 5000, 8],
    ]) {
      await db.client`INSERT INTO answer_runs(organization_id,event_id,mode,outcome,decision,created_at)
        VALUES(${a.id},${ev.id},'live',${outcome},${db.client.json({ reasonCode, durationMs, answer: 'private fixture text' })},now()-${age}::int * interval '1 day')`;
    }
    await db.client`INSERT INTO ai_operations(id,organization_id,event_id,day,funding,status,reserved_micros,cost_micros)
      VALUES(${randomUUID()},${a.id},${ev.id},current_date-1,'byok','settled',100,17)`;
    const daily = await call('GET', event + '/analytics?days=1', other.token);
    assert.equal(daily.questions, 2);
    assert.equal(daily.answered, 1);
    assert.equal(daily.usage.settledCostMicros, 0);
    const live = daily.byMode.find((row) => row.mode === 'live');
    assert.deepEqual(live.latencyMs, { p50: 60, p95: 105 });
    assert.deepEqual(live.outcomes, { approved_faq: 1, handoff: 1 });
    const month = await call('GET', event + '/analytics?days=30', other.token);
    assert.equal(month.questions, 3);
    assert.equal(month.usage.byokCostMicros, 17);
    assert.equal(month.usage.settledOperations, 1);
    assert.equal(JSON.stringify(month).includes('private fixture text'), false);
    await call('GET', event + '/analytics?days=91', other.token, undefined, 400);
    await call('POST', event + '/sources', other.token, { kind: 'faq', title: 'Q', body: 'A' }, 403);
    await call('PATCH', root + '/' + a.id + '/memberships/' + member.id, owner.token, { role: 'editor' });
    const src = await call(
      'POST',
      event + '/sources',
      other.token,
      { kind: 'faq', title: 'When?', body: 'Monday', language: 'en' },
      201,
    );
    const source = event + '/sources/' + src.id;
    const preview = (mode = 'published_preview') =>
      call('POST', event + '/playground', owner.token, { question: 'When?', language: 'en', mode });
    assert.equal((await preview('draft_preview')).answer, 'Monday');
    assert.notEqual((await preview()).answer, 'Monday');
    const botToken = botIdentity + ':' + randomBytes(32).toString('base64url'),
      secret = randomBytes(24).toString('hex');
    const bot = await call(
      'POST',
      event + '/bots',
      owner.token,
      { token: botToken, webhookSecret: secret, name: 'Mock Telegram' },
      201,
    );
    assert.equal(JSON.stringify(bot).includes(botToken), false);
    assert.equal(JSON.stringify(bot).includes(secret), false);
    assert.deepEqual(await call('POST', event + '/bots/' + bot.id + '/webhook', owner.token, { webhookSecret: secret }), { configured: true });
    const webhook = async (s) =>
      fetch(base + '/webhooks/telegram/' + bot.id, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': s },
        body: JSON.stringify({ update_id: 1, message: { text: 'Question' } }),
      });
    assert.equal((await webhook('wrong')).status, 404);
    assert.equal((await webhook(secret)).status, 404);
    await call('PATCH', event, owner.token, { status: 'active' });
    assert.equal((await webhook(secret)).status, 200);
    assert.equal((await webhook(secret)).status, 200);
    const received =
      await db.client`SELECT payload FROM telegram_inbox WHERE organization_id=${a.id} AND event_id=${ev.id} AND bot_id=${bot.id}`;
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.update_id, 1);
    const [ticket] = await db.client`INSERT INTO handoffs(organization_id,event_id,bot_id,chat_id,question)
      VALUES(${a.id},${ev.id},${bot.id},'123','Which hall?') RETURNING id`;
    const reply = () =>
      call('POST', event + '/handoffs/' + ticket.id + '/reply', owner.token, { text: 'Hall A', createFaqDraft: true });
    const resolved = await reply();
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.deliveryStatus, 'pending');
    assert.equal((await reply()).faqDraftId, resolved.faqDraftId);
    const outbox =
      await db.client`SELECT body FROM telegram_outbox WHERE organization_id=${a.id} AND event_id=${ev.id} AND bot_id=${bot.id}`;
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].body, 'Hall A');
    await db.client`UPDATE telegram_outbox SET status='uncertain'
      WHERE organization_id=${a.id} AND event_id=${ev.id} AND bot_id=${bot.id} AND dedupe_key=${'reply:' + ticket.id}`;
    const inbox = await call('GET', event + '/handoffs', owner.token);
    assert.equal(inbox.items.find(item => item.id === ticket.id).deliveryStatus, 'uncertain');
    const unpublished =
      await db.client`SELECT published_version_id FROM knowledge_sources WHERE organization_id=${a.id} AND event_id=${ev.id} AND id=${resolved.faqDraftId}`;
    assert.equal(unpublished[0].published_version_id, null);
    const settings = await call('PATCH', event + '/ai-settings', owner.token, {
      funding: 'byok',
      key: 'fixture-provider-key',
      dailyLimitMicros: 10000,
    });
    assert.deepEqual(settings, { funding: 'byok', hasKey: true, dailyLimitMicros: 10000 });
    await call('GET', event + '/ai-settings', other.token, undefined, 403);
    const one = await call('POST', source + '/publish', other.token, {});
    const same = { requestId: randomUUID(), question: 'When?', language: 'en', mode: 'published_preview' };
    const run = await call('POST', event + '/playground', owner.token, same);
    await call('GET', event + '/playground/' + same.requestId, other.token, undefined, 404);
    assert.deepEqual(await call('POST', event + '/playground', owner.token, same), run);
    await call('POST', event + '/playground', other.token, same, 409);
    await call('POST', event + '/playground', owner.token, { ...same, question: 'Another question' }, 409);
    await call('POST', event + '/playground', owner.token, { ...same, conversation: [{question:'Earlier condition',answer:'Clarify'}] }, 409);
    for (const conversation of ['untrusted string', [{question:'x',answer:42}], Array(4).fill({question:'x',answer:''})])
      await call('POST', event + '/playground', owner.token, { ...same, requestId: randomUUID(), conversation }, 400);
    assert.equal((await preview()).answer, 'Monday');
    await call('PATCH', source, other.token, { body: 'Tuesday' });
    assert.equal((await preview()).answer, 'Monday');
    await call('POST', source + '/publish', other.token, {});
    assert.equal((await preview()).answer, 'Tuesday');
    await call('POST', source + '/rollback', other.token, { versionId: one.publishedVersionId });
    assert.equal((await preview()).answer, 'Monday');
    await call('POST', source + '/revoke', other.token, {});
    await call('POST', event + '/playground', owner.token, same, 409);
    const audit = (await call('GET', event + '/audit?limit=100', owner.token)).items;
    assert.ok(
      audit.some(
        (row) => row.action === 'publication.revoke' && row.resourceId === src.id && row.actorId === other.user.id,
      ),
    );
    assert.ok(!JSON.stringify(audit).includes('fixture-provider-key'));
    assert.notEqual((await preview()).answer, 'Monday');
    const ownerMembership = (await call('GET', root + '/' + a.id + '/memberships', owner.token)).items.find(
      (m) => m.role === 'owner',
    );
    await call('DELETE', root + '/' + a.id + '/memberships/' + ownerMembership.id, owner.token, undefined, 409);
    const membershipPath = root + '/' + a.id + '/memberships/' + member.id;
    await call('PATCH', membershipPath, owner.token, { role: 'moderator' });
    await call('GET', event + '/sources', other.token, undefined, 403);
    await call('POST', source + '/publish', other.token, {}, 403);
    const [second] =
      await db.client`INSERT INTO handoffs(organization_id,event_id,question) VALUES(${a.id},${ev.id},'Needs follow-up') RETURNING id`;
    const ticketPath = event + '/handoffs/' + second.id;
    const assigned = await call('POST', ticketPath + '/assign', owner.token, { membershipId: member.id });
    assert.equal(assigned.assignedMembershipId, member.id);
    assert.equal((await call('POST', ticketPath + '/close', other.token, {})).status, 'closed');
    await call('PATCH', membershipPath, owner.token, { role: 'admin' });
    await call('PATCH', membershipPath, other.token, { role: 'owner' }, 403);
    await call('DELETE', root + '/' + a.id + '/memberships/' + ownerMembership.id, other.token, undefined, 403);
    const rotatedSecret = randomBytes(24).toString('base64url');
    await call('POST', event + '/bots/' + bot.id + '/rotate', owner.token, {
      token: botToken,
      webhookSecret: rotatedSecret,
    });
    assert.equal((await webhook(secret)).status, 404);
    assert.equal((await webhook(rotatedSecret)).status, 200);
    await call('PATCH', event + '/bots/' + bot.id, owner.token, { active: false });
    assert.equal((await webhook(rotatedSecret)).status, 404);
    await call('POST', '/api/v1/auth/logout', owner.token, {}, 204);
    await call('GET', event + '/sources', owner.token, undefined, 401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const id of orgs) await db.client`DELETE FROM organizations WHERE id=${id}`;
    for (const id of users) await db.client`DELETE FROM users WHERE id=${id}`;
    await app.close();
    await db.close();
  }
});
