import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { EventsController } from '../src/product/events.controller.js';
import type { ProductAccess } from '../src/product/access.js';
vi.mock('../src/product/playground.js', () => ({ playground: vi.fn() }));

const p = { org: '11111111-1111-4111-8111-111111111111', event: '22222222-2222-4222-8222-222222222222', id: '33333333-3333-4333-8333-333333333333' };
describe('moderator feedback export', () => {
  function controller(rows: object[]) {
    const scoped = vi.fn(async (_auth, _org, _event, _roles, callback) => callback(async () => rows, { org: p.org, event: p.event }));
    return { scoped, api: new EventsController({ scoped } as unknown as ProductAccess) };
  }
  it('requires editing access and exports a human-reviewable case without running it', async () => {
    const { scoped, api } = controller([{ question: 'Где вход?', source_id: 'faq', language: 'kk', body: 'Сол жақта.' }]);
    const result = await api.evaluationCase('Bearer fixture', p);
    expect(scoped.mock.calls[0]?.slice(0, 4)).toEqual(['Bearer fixture', p.org, p.event, ['owner', 'admin', 'editor']]);
    expect(result).toMatchObject({ reviewRequired: true, referenceAnswer: 'Сол жақта.', cases: [{ question: 'Где вход?', expectedSourceId: 'faq', language: 'kk' }] });
  });
  it('does not export an unresolved or unpublished correction', async () => {
    const { api } = controller([]);
    await expect(api.evaluationCase('Bearer fixture', p)).rejects.toBeInstanceOf(ConflictException);
  });
});
