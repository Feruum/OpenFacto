import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ProductAccess } from '../src/product/access.js';
import { digest } from '../src/product/telegram-auth.js';

const { wake } = vi.hoisted(() => ({ wake: vi.fn() }));
vi.mock('@openfacto/worker/wake', () => ({ requestBusinessWake: wake }));
import { playground } from '../src/product/playground.js';
import { WebhookController } from '../src/product/bots.controller.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('durable ingress wake boundary', () => {
  it('wakes Playground only after a pending transaction commits, not for a completed replay', async () => {
    wake.mockClear();
    const commit = deferred<{ requestId: string; status: string }>();
    const access = { scoped: () => commit.promise } as unknown as ProductAccess;
    const requestId = randomUUID(), scope = { org: randomUUID(), event: randomUUID() };
    const result = playground(access, 'fixture', scope, { requestId, question: 'Where?' });
    expect(wake).not.toHaveBeenCalled();
    commit.resolve({ requestId, status: 'pending' });
    await result;
    expect(wake).toHaveBeenCalledTimes(1);
    wake.mockClear();
    const completed = { scoped: async () => ({ requestId, status: 'completed' }) } as unknown as ProductAccess;
    await playground(completed, 'fixture', scope, { requestId, question: 'Where?' });
    expect(wake).not.toHaveBeenCalled();
  });

  it('does not wake on a failed Playground transaction', async () => {
    wake.mockClear();
    const access = { scoped: async () => { throw new Error('rollback'); } } as unknown as ProductAccess;
    await expect(playground(access, 'fixture', { org: randomUUID(), event: randomUUID() },
      { requestId: randomUUID(), question: 'Where?' })).rejects.toThrow('rollback');
    expect(wake).not.toHaveBeenCalled();
  });

  it.each([false, true])('Telegram wake follows commit; rollback=%s never publishes uncommitted work', async rollback => {
    wake.mockClear();
    const commit = deferred<void>(), inserted = deferred<void>(), secret = 'fixture-secret';
    const tx = Object.assign(async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('SELECT')) return [{ organization_id: randomUUID(), event_id: randomUUID(), webhook_secret_hash: digest(secret) }];
      inserted.resolve();
      return [];
    }, { json: (value: unknown) => value });
    const access = { database: { client: { begin: async (action: (tx: unknown) => Promise<unknown>) => {
      await action(tx);
      await commit.promise;
    } } } } as unknown as ProductAccess;
    const result = new WebhookController(access).receive(randomUUID(), secret, { update_id: 1 });
    await inserted.promise;
    expect(wake).not.toHaveBeenCalled();
    if (rollback) {
      const failed = expect(result).rejects.toThrow('rollback');
      commit.reject(new Error('rollback'));
      await failed;
      expect(wake).not.toHaveBeenCalled();
    } else {
      commit.resolve();
      expect(await result).toEqual({ ok: true });
      expect(wake).toHaveBeenCalledTimes(1);
    }
  });
});
