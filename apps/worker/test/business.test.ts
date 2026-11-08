import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, RabbitTransport } from '@openfacto/queue';

const mocked = vi.hoisted(() => ({
  sql: vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => []),
  close: vi.fn(async () => {}), processUpdate: vi.fn(async () => {}), deliver: vi.fn(async () => {}),
  playground: vi.fn(async () => {}), evaluation: vi.fn(async () => {}),
  ingestion: vi.fn(async () => {}), sweepIngestion: vi.fn(async () => {}),
}));
vi.mock('@openfacto/database', () => ({ createDatabase: () => ({ client: mocked.sql, close: mocked.close }) }));
vi.mock('../src/telegram.js', () => ({ processUpdate: mocked.processUpdate, deliver: mocked.deliver }));
vi.mock('../src/playground-jobs.js', () => ({ processPlaygroundJob: mocked.playground }));
vi.mock('../src/evaluations.js', () => ({ evaluateCase: mocked.evaluation }));
vi.mock('../src/ingestion.js', () => ({ processIngestionJob: mocked.ingestion, sweepIngestion: mocked.sweepIngestion }));
vi.mock('../src/ingestion-vectors.js', () => ({ modelConfig: () => ({ collection: 'fixture' }) }));

import { businessWorkers } from '../src/business.js';
import { requestBusinessWake } from '../src/business-wake.js';

describe('business worker wake integration', () => {
  const workers: ReturnType<typeof businessWorkers>[] = [];
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubEnv('AI_IMMEDIATE_DISPATCH', '1'); vi.clearAllMocks();
    mocked.sql.mockImplementation(async () => []);
  });
  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.close()));
    vi.useRealTimers(); vi.unstubAllEnvs();
  });
  function create() {
    const consumers = new Map<string, (job: Job) => Promise<unknown>>();
    const transport = { consume(queue: string, handler: (job: Job) => Promise<unknown>) {
      consumers.set(queue, handler);
    }, publish: vi.fn(async () => {}) } as unknown as RabbitTransport;
    const worker = businessWorkers(transport, 'postgres://fixture', 2, vi.fn());
    workers.push(worker);
    return { worker, consumers };
  }
  const sweeps = () => mocked.sql.mock.calls.filter(([strings]) => strings.join('').includes("UPDATE telegram_outbox SET status='uncertain'")).length;

  it('wakes dispatch after a consumer removes its SQL notification lease', async () => {
    const { worker, consumers } = create();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    expect(sweeps()).toBe(1);
    await consumers.get('ai.questions')!({ name: 'telegram', data: { id: 'incoming' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.processUpdate).toHaveBeenCalledOnce();
    expect(mocked.sql.mock.calls.some(([strings, ...values]) => strings.join('').startsWith('DELETE FROM queue_dispatches') && values.includes('incoming'))).toBe(true);
    expect(sweeps()).toBe(2);
  });

  it('retains periodic recovery when immediate dispatch is disabled', async () => {
    vi.stubEnv('AI_IMMEDIATE_DISPATCH', '0');
    const { worker, consumers } = create();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    await consumers.get('messages.delivery')!({ name: 'outgoing', data: { id: 'reply' } });
    requestBusinessWake(); await vi.advanceTimersByTimeAsync(1999);
    expect(sweeps()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweeps()).toBe(2);
  });

  it('releases a failed handler lease without immediately retrying and recovers on the timer', async () => {
    const { worker, consumers } = create();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    mocked.processUpdate.mockRejectedValueOnce(new Error('Failed before claiming the job'));
    await expect(consumers.get('ai.questions')!({ name: 'telegram', data: { id: 'failed-incoming' } }))
      .rejects.toThrow('Failed before claiming the job');
    expect(mocked.sql.mock.calls.some(([strings, ...values]) =>
      strings.join('').startsWith('DELETE FROM queue_dispatches') && values.includes('failed-incoming'))).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sweeps()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(sweeps()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweeps()).toBe(2);
    expect(mocked.processUpdate).toHaveBeenCalledOnce();
  });

  it('waits for an active SQL sweep before closing its database', async () => {
    let finish!: () => void;
    mocked.sql.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]); }));
    const { worker } = create();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    requestBusinessWake();
    const closing = worker.close();
    await vi.advanceTimersByTimeAsync(0);
    const closedBeforeDrain = mocked.close.mock.calls.length > 0;
    finish(); await closing;
    expect(closedBeforeDrain).toBe(false);
    expect(mocked.close).toHaveBeenCalledOnce();
    expect(sweeps()).toBe(1);
  });

  it('does not accelerate maintenance and ingestion scans with frequent wake notifications', async () => {
    const { worker } = create();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 12; index++) {
      requestBusinessWake(); await vi.advanceTimersByTimeAsync(0);
    }
    expect(sweeps()).toBe(13);
    expect(mocked.sweepIngestion).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocked.sweepIngestion).toHaveBeenCalledTimes(2);
  });
});
