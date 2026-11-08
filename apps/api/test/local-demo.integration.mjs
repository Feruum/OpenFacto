import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@openfacto/database';
import { createLogger } from '@openfacto/logger';
import { AppModule } from '../dist/app.module.js';
import { configureHttp } from '../dist/http.js';
import { processPlaygroundJob } from '@openfacto/worker/playground-jobs';

test('opt-in local workspace uses real scoped API and refuses cross-origin bootstrap', async () => {
  const saved = process.env.LOCAL_DEMO_ENABLED;
  process.env.LOCAL_DEMO_ENABLED = '1';
  const config = { databaseUrl: process.env.DATABASE_URL, rabbitmqUrl: process.env.RABBITMQ_URL,
    nodeEnv: 'development', host: '127.0.0.1', port: 0, logLevel: 'error', dependencyTimeoutMs: 1000,
    miniAppOrigin: 'http://127.0.0.1:55173' };
  const app = await NestFactory.create(AppModule.register(config), { logger: false });
  const db = createDatabase(config.databaseUrl);
  let userId, organizationId;
  try {
    await configureHttp(app, config.miniAppOrigin, createLogger('test','error',()=>{}));
    await app.listen(0,'127.0.0.1');
    const base = await app.getUrl(); config.port = Number(new URL(base).port);
    const login = (headers = {}) => fetch(base + '/api/v1/auth/local-demo', {
      method: 'POST', headers: { 'content-type':'application/json', origin: config.miniAppOrigin, ...headers }, body: '{}',
    });
    assert.equal((await login({ origin:'https://other.example' })).status,404);
    assert.equal((await login({ 'x-forwarded-for':'203.0.113.1' })).status,404);
    const response = await login(); assert.equal(response.status,200);
    const session = await response.json(); userId = session.user.id;
    const second = await (await login()).json(); assert.equal(second.user.id,userId); assert.notEqual(second.token,session.token);
    const headers = { authorization:'Bearer ' + session.token, 'content-type':'application/json' };
    const organizations = await (await fetch(base + '/api/v1/organizations', {headers})).json();
    assert.equal(organizations.items.length,1); organizationId=organizations.items[0].id;
    const events = await (await fetch(base + '/api/v1/organizations/' + organizationId + '/events', {headers})).json();
    const event = base + '/api/v1/organizations/' + organizationId + '/events/' + events.items[0].id;
    const submitted = await fetch(event + '/playground', { method:'POST', headers,
      body:JSON.stringify({question:'Где проходит регистрация?',language:'ru'}) });
    assert.equal(submitted.status,202);
    const task = await submitted.json();
    await processPlaygroundJob(db.client,task.requestId);
    const {decision:answer} = await (await fetch(event + '/playground/' + task.requestId,{headers})).json();
    assert.equal(answer.outcome,'approved_faq'); assert.equal(answer.usage.paidOperations,0);
    assert.equal((await fetch(event + '/sources')).status,401);
    process.env.LOCAL_DEMO_ENABLED='0'; assert.equal((await login()).status,404);
  } finally {
    if (organizationId) await db.client`DELETE FROM organizations WHERE id=${organizationId}`;
    if (userId) await db.client`DELETE FROM users WHERE id=${userId}`;
    await app.close(); await db.close();
    if(saved === undefined) delete process.env.LOCAL_DEMO_ENABLED; else process.env.LOCAL_DEMO_ENABLED=saved;
  }
});
