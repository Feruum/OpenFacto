import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBusinessSweepScheduler, requestBusinessWake, subscribeBusinessWake } from '../src/business-wake.js';

describe('business dispatch wake scheduling', () => {
  const close: Array<() => Promise<void>> = [];
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('AI_IMMEDIATE_DISPATCH', '1'); });
  afterEach(async () => {
    await Promise.all(close.splice(0).map(stop => stop()));
    vi.useRealTimers(); vi.unstubAllEnvs();
  });
  function scheduler(sweep = vi.fn(async () => {}), report = vi.fn()) {
    const worker = createBusinessSweepScheduler(sweep, report);
    close.push(() => worker.close());
    return { worker, sweep, report };
  }

  it('starts once and immediately sweeps on a wake without waiting for the recovery timer', async () => {
    const { worker, sweep } = scheduler();
    worker.start(); worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    requestBusinessWake();
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('coalesces a synchronous burst into one sweep and does not spin afterward', async () => {
    const { worker, sweep } = scheduler();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 50; index++) requestBusinessWake();
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('latches one follow-up when wakes arrive during an active sweep without overlapping it', async () => {
    let finish!: () => void;
    let active = 0, maximum = 0;
    const sweep = vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      if (sweep.mock.calls.length === 1) await new Promise<void>(resolve => { finish = resolve; });
      active--;
    });
    const { worker } = scheduler(sweep);
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 50; index++) requestBusinessWake();
    expect(sweep).toHaveBeenCalledTimes(1);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(maximum).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('keeps the two-second recovery sweep when immediate dispatch is disabled', async () => {
    vi.stubEnv('AI_IMMEDIATE_DISPATCH', '0');
    const { worker, sweep } = scheduler();
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    requestBusinessWake(); await vi.advanceTimersByTimeAsync(1999);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    vi.stubEnv('AI_IMMEDIATE_DISPATCH', '1');
    requestBusinessWake(); await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('stops notifications, discards pending work and drains the active sweep before closing', async () => {
    let finish!: () => void;
    const { worker, sweep } = scheduler(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    requestBusinessWake();
    worker.stop();
    let closed = false;
    const closing = worker.close().then(() => { closed = true; });
    requestBusinessWake(); worker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closed).toBe(false);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    finish(); await closing;
    expect(closed).toBe(true);
    requestBusinessWake(); await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('reports sweep failures and recovers on the next explicit wake', async () => {
    const sweep = vi.fn(async () => {}).mockRejectedValueOnce(new Error('SQL unavailable'));
    const { worker, report } = scheduler(sweep);
    worker.start(); await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledOnce();
    requestBusinessWake(); await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listeners and isolates failures from committed API writes', () => {
    const second = vi.fn();
    const offFirst = subscribeBusinessWake(() => { throw new Error('Listener failed'); });
    const offSecond = subscribeBusinessWake(second);
    try {
      expect(() => requestBusinessWake()).not.toThrow();
      expect(second).toHaveBeenCalledOnce();
      offSecond(); requestBusinessWake();
      expect(second).toHaveBeenCalledOnce();
    } finally { offFirst(); offSecond(); }
  });

  it('does not repeatedly visit listeners registered during notification delivery', () => {
    const late = vi.fn();
    let offLate: (() => void) | undefined;
    const offFirst = subscribeBusinessWake(() => { offLate ??= subscribeBusinessWake(late); });
    try {
      requestBusinessWake(); expect(late).not.toHaveBeenCalled();
      requestBusinessWake(); expect(late).toHaveBeenCalledOnce();
    } finally { offFirst(); offLate?.(); }
  });
});
