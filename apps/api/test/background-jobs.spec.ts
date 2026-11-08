import { afterEach, expect, it, vi } from 'vitest';
import { BackgroundJobs } from '../src/background-jobs.js';
import { startBackgroundJobs } from '@openfacto/worker/runtime';
import type { WorkerConfig } from '@openfacto/config';

vi.mock('@openfacto/worker/runtime', () => ({ startBackgroundJobs: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const config: WorkerConfig = {nodeEnv:'test',databaseUrl:'postgresql://localhost/test',rabbitmqUrl:'amqp://localhost',
  logLevel:'error',dependencyTimeoutMs:1000,concurrency:2};

it('awaits queue startup and awaits draining on application shutdown', async () => {
  let drained = false;
  const stop = vi.fn(async () => { await Promise.resolve(); drained = true; });
  vi.mocked(startBackgroundJobs).mockResolvedValue(stop);
  const service = new BackgroundJobs(config);
  await service.onApplicationBootstrap();
  expect(startBackgroundJobs).toHaveBeenCalledWith(config);
  await service.onModuleDestroy();
  expect(stop).toHaveBeenCalledOnce();
  expect(drained).toBe(true);
});

it('propagates broker startup failure and tolerates teardown before startup', async () => {
  const service = new BackgroundJobs(config);
  await service.onModuleDestroy();
  vi.mocked(startBackgroundJobs).mockRejectedValue(new Error('Broker unavailable'));
  await expect(service.onApplicationBootstrap()).rejects.toThrow('Broker unavailable');
  await service.onModuleDestroy();
});
