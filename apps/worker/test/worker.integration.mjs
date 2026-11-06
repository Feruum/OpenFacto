import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '@openfacto/config';
import { FOUNDATION_QUEUE } from '../dist/processor.js';
test('a separate worker process consumes a real Redis job', { timeout: 20000 }, async () => {
  assert.ok(process.env.REDIS_URL, 'REDIS_URL is required');
  const connection = { ...redisConnection(process.env.REDIS_URL), maxRetriesPerRequest: 1 };
  const queue = new Queue(FOUNDATION_QUEUE, { connection });
  const events = new QueueEvents(FOUNDATION_QUEUE, { connection: { ...connection, maxRetriesPerRequest: null } });
  const child = spawn(process.execPath, ['dist/main.js'], { env: process.env, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await events.waitUntilReady();
    const job = await queue.add('smoke', { requestId: randomUUID() }, { removeOnComplete: true, removeOnFail: true });
    assert.equal((await job.waitUntilFinished(events, 10000)).status, 'ok');
    child.kill('SIGTERM');
    const result = await Promise.race([exited, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker did not stop')), 5000); timer.unref();
    })]);
    assert.equal(result.code, 0);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await events.close();
    await queue.close();
  }
});
