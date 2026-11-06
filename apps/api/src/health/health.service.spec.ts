import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service.js';
describe('readiness', () => {
  it('requires both dependencies', async () => {
    const service = new HealthService({ postgres: async () => {}, redis: async () => {} });
    expect(await service.ready()).toEqual({ status: 'ok', dependencies: { postgres: 'up', redis: 'up' } });
  });
  it.each(['postgres', 'redis'] as const)('reports %s down and recovers on the next probe', async (dependency) => {
    const fail = vi.fn().mockRejectedValueOnce(new Error('SECRET')).mockResolvedValue(undefined);
    const service = new HealthService({ postgres: async () => {}, redis: async () => {}, [dependency]: fail });
    const result = await service.ready();
    expect(result.status).toBe('unavailable');
    expect(result.dependencies[dependency]).toBe('down');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect((await service.ready()).status).toBe('ok');
  });
  it('coalesces concurrent probes during an outage', async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const service = new HealthService({ postgres: probe, redis: async () => {} });
    const first = service.ready(); const second = service.ready();
    expect(probe).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toEqual(await second);
  });
  it('reports a synchronous dependency failure as unavailable', async () => {
    const service = new HealthService({ postgres: () => { throw new Error('SECRET'); }, redis: async () => {} });
    expect(await service.ready()).toEqual({ status: 'unavailable', dependencies: { postgres: 'down', redis: 'up' } });
  });
});
