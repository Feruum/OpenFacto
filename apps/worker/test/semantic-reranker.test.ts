import { afterEach, expect, it, vi } from 'vitest';
import type { Evidence } from '@openfacto/answer-engine';
import { semanticRerank } from '../src/semantic-reranker.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const items = [{ title: 'one', text: 'first' }, { title: 'two', text: 'second' }] as Evidence[];
it('reorders only existing authorized objects', async () => {
  vi.stubEnv('RERANK_URL', 'http://127.0.0.1:7312/v1/rerank');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [{ index: 0, score: 0.1 }, { index: 1, score: 0.9 }] })));
  const ranked = await semanticRerank('question', items);
  expect(ranked[0]).toBe(items[1]);
});
it('rejects remote endpoints and duplicate or foreign candidate indices', async () => {
  vi.stubEnv('RERANK_URL', 'https://remote.example/v1/rerank');
  await expect(semanticRerank('question', items)).rejects.toThrow('provider_unavailable');
  vi.stubEnv('RERANK_URL', 'http://127.0.0.1:7312/v1/rerank');
  for (const indexes of [[0, 0], [0, 2]]) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: indexes.map(index => ({ index, score: 1 })) })));
    await expect(semanticRerank('question', items)).rejects.toThrow('provider_unavailable');
  }
});
