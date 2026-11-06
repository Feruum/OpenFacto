import { describe, expect, it } from 'vitest';
import { processFoundationJob } from '../src/processor.js';
describe('foundation queue', () => {
  it('handles a bounded, non-domain smoke job', async () => {
    expect(await processFoundationJob({ name: 'smoke', data: { requestId: 'smoke-1' } })).toEqual({ status: 'ok', requestId: 'smoke-1' });
  });
  it('rejects unsupported work and malformed payloads', async () => {
    await expect(processFoundationJob({ name: 'parse-pdf', data: {} })).rejects.toThrow('Unsupported');
    for (const data of [null, {}, { requestId: '../private' }, { requestId: 'x'.repeat(65) }]) await expect(processFoundationJob({ name: 'smoke', data })).rejects.toThrow('Invalid');
  });
});
