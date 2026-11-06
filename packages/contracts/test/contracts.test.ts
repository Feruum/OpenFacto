import { describe, expect, it } from 'vitest';
import { API_PREFIX, isReadyResponse, locales } from '../src/index.js';
describe('public contract', () => {
  it('uses one business prefix and ISO language codes', () => {
    expect(API_PREFIX).toBe('/api/v1');
    expect(locales).toEqual(['ru', 'kk', 'en']);
  });
  it('validates health bodies from an untrusted API', () => {
    expect(isReadyResponse({ status: 'ok', dependencies: { postgres: 'up', redis: 'up' } })).toBe(true);
    expect(isReadyResponse({ status: 'unavailable', dependencies: { postgres: 'down', redis: 'up' } })).toBe(true);
    for (const value of [null, {}, { status: 'ok' }, { status: 'ok', dependencies: { postgres: 'down', redis: 'up' } }]) expect(isReadyResponse(value)).toBe(false);
  });
});
