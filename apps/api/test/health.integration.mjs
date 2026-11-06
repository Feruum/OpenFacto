import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
test('compiled API checks real PostgreSQL and Redis', { timeout: 20000 }, async () => {
  assert.ok(process.env.DATABASE_URL && process.env.REDIS_URL, 'DATABASE_URL and REDIS_URL required');
  const port = process.env.INTEGRATION_API_PORT ?? '33001';
  const child = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: port }, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    let response;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'API exited before becoming ready');
      try {
        response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) break;
      } catch { /* Wait for startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', dependencies: { postgres: 'up', redis: 'up' } });
    const missing = await fetch(`http://127.0.0.1:${port}/api/v1/organizations`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).requestId, missing.headers.get('x-request-id'));
    child.kill('SIGTERM');
    const stopTimer = new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('API did not stop')), 5000); timer.unref(); });
    const stopped = await Promise.race([exited, stopTimer]);
    assert.ok(stopped.code === 0 || stopped.signal === 'SIGTERM', 'API should stop gracefully');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
