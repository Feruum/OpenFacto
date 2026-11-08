import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createDatabase } from '@openfacto/database';

test('backend exits instead of serving HTTP without its unavailable broker', {timeout:15_000}, async () => {
  const child=spawn(process.execPath,['dist/main.js'],{
    env:{...process.env,API_PORT:'33110',RABBITMQ_URL:'amqp://127.0.0.1:1/0',DEPENDENCY_TIMEOUT_MS:'100',LOG_LEVEL:'error'},
    stdio:'ignore',
  });
  const exited=new Promise(resolve => child.once('exit',code => resolve(code)));
  try {
    const code=await Promise.race([exited,new Promise((_,reject) => {
      const timer=setTimeout(() => reject(new Error('Failed broker startup left the backend running')),10_000);timer.unref();
    })]);
    assert.equal(code,1);
  } finally { if(child.exitCode===null) { child.kill('SIGKILL');await exited; } }
});

test('one backend process accepts, enqueues and consumes an evaluation, then drains on shutdown', { timeout: 60_000 }, async () => {
  assert.ok(process.env.DATABASE_URL && process.env.RABBITMQ_URL);
  const port = process.env.INTEGRATION_JOBS_API_PORT ?? '33109';
  const origin = 'http://127.0.0.1:55173';
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, NODE_ENV:'development', API_HOST:'127.0.0.1', API_PORT:port,
      MINI_APP_ORIGIN:origin, LOCAL_DEMO_ENABLED:'1', EMBEDDING_URL:'', LOG_LEVEL:'error' },
    stdio:['ignore','ignore','ignore','ipc'],
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code,signal})));
  const db = createDatabase(process.env.DATABASE_URL);
  let organizationId, userId;
  try {
    let ready = false;
    for (let attempt=0; attempt<100; attempt++) {
      assert.equal(child.exitCode, null, 'Backend exited during startup');
      try { ready = (await fetch(base + '/health/ready', {signal:AbortSignal.timeout(1000)})).ok; }
      catch { /* Wait for the child to bind. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Backend should be ready');
    const login = await fetch(base + '/api/v1/auth/local-demo', { method:'POST',
      headers:{origin,'content-type':'application/json'},body:'{}' });
    assert.equal(login.status, 200);
    const session = await login.json(); userId = session.user.id;
    const headers = {authorization:'Bearer ' + session.token,'content-type':'application/json'};
    const organizations = await (await fetch(base + '/api/v1/organizations',{headers})).json();
    organizationId = organizations.items[0].id;
    const events = await (await fetch(base + `/api/v1/organizations/${organizationId}/events`,{headers})).json();
    const endpoint = base + `/api/v1/organizations/${organizationId}/events/${events.items[0].id}/evaluations`;
    const response = await fetch(endpoint, {method:'POST',headers,body:JSON.stringify({cases:[{
      question:'Где проходит регистрация?',language:'ru',expectedOutcome:'approved_faq',
    }]})});
    assert.equal(response.status,201);
    let run = await response.json();
    const deadline = Date.now()+30_000;
    while (run.status !== 'completed' && Date.now()<deadline) {
      assert.notEqual(run.status, 'failed');
      await new Promise(resolve => setTimeout(resolve,200));
      const status = await fetch(endpoint+'/'+run.id,{headers});
      assert.equal(status.status,200, 'HTTP remains available while background tasks run');
      run = await status.json();
    }
    assert.equal(run.status,'completed');
    assert.equal(run.results.length,1);
    assert.equal(run.results[0].passed,true);
    child.disconnect();
    const stopped = await Promise.race([exited,new Promise((_,reject) => {
      const timer=setTimeout(() => reject(new Error('Backend consumers did not stop')),5000); timer.unref();
    })]);
    assert.equal(stopped.code,0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    if (organizationId) await db.client`DELETE FROM organizations WHERE id=${organizationId}`;
    if (userId) await db.client`DELETE FROM users WHERE id=${userId}`;
    await db.close();
  }
});
