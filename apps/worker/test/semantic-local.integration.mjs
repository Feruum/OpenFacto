import assert from 'node:assert/strict';
import test from 'node:test';
import { dense, modelConfig } from '../dist/ingestion-vectors.js';
import { semanticRerank } from '../dist/semantic-reranker.js';

test('pinned local embeddings distinguish query/passage and support Kazakh retrieval', { skip: !process.env.EMBEDDING_URL, timeout: 60_000 }, async () => {
  const config = modelConfig();
  const [query] = await dense(['Бейджді қайдан аламын?'], config, 'query');
  const vectors = await dense(['Бейдж выдают на стойке регистрации.', 'Парковка находится у северного входа.'], config);
  const similarity = vector => query.reduce((sum, value, i) => sum + value * vector[i], 0);
  assert.equal(query.length, 384);
  assert.ok(similarity(vectors[0]) > similarity(vectors[1]));
  const [passage] = await dense(['Бейджді қайдан аламын?'], config, 'passage');
  assert.notDeepEqual(query, passage);
  const origin = new URL(config.url).origin;
  const rejected = await fetch(origin + '/v1/embeddings', { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: '{}' });
  assert.equal(rejected.status, 403);
  const previous = process.env.RERANK_URL;
  try {
    process.env.RERANK_URL = origin + '/v1/rerank';
    const items = [{ title: 'Парковка', text: 'Машины у северного входа' }, { title: 'Бейдж', text: 'Бейдж выдают на регистрации' }];
    const ranked = await semanticRerank('Где получить бейдж?', items);
    assert.equal(ranked[0], items[1]);
  } finally { if (previous === undefined) delete process.env.RERANK_URL; else process.env.RERANK_URL = previous; }
});
