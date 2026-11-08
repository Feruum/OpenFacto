import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  candidates,
  chunkPages,
  dense,
  ensureCollection,
  modelConfig,
  rerank,
  upsert,
} from '../dist/ingestion-vectors.js';

// Each pair has one labeled relevant passage. Include both direct wording and paraphrases.
const corpus = [
  [
    'ru',
    'Регистрация участников открывается в девять утра у главного входа.',
    'Когда открывается регистрация участников?',
    'Во сколько можно записаться на мероприятие?',
  ],
  [
    'ru',
    'Регистрация волонтёров завершается в четверг в 18:00.',
    'Когда завершается регистрация волонтёров?',
    'До какого дня принимают помощников?',
  ],
  [
    'ru',
    'Церемония открытия пройдёт в актовом зале на втором этаже.',
    'Где пройдёт церемония открытия?',
    'В каком помещении будет старт праздника?',
  ],
  [
    'ru',
    'Церемония награждения финалистов начинается в 17:30 на сцене.',
    'Когда начинается награждение финалистов?',
    'Во сколько вручат призы победителям?',
  ],
  [
    'kk',
    'Командалардың жобаны тапсыру мерзімі жұма күні сағат 15:00-де аяқталады.',
    'Жобаны тапсыру мерзімі қашан аяқталады?',
    'Дайын жұмысты қай күнге дейін өткізуге болады?',
  ],
  [
    'kk',
    'Командалардың жоба қорғауы сенбі күні үлкен залда өтеді.',
    'Жоба қорғауы қай залда өтеді?',
    'Топтар өз жұмыстарын қай жерде таныстырады?',
  ],
  [
    'kk',
    'Түскі ас бірінші қабаттағы асханада беріледі.',
    'Түскі ас қай жерде беріледі?',
    'Қатысушылар түсте қайда тамақтанады?',
  ],
  [
    'kk',
    'Кешкі ас қонақүйдің шағын мейрамханасында беріледі.',
    'Кешкі ас қайда беріледі?',
    'Кешке қай жерде тамақтануға болады?',
  ],
  [
    'en',
    'The airport shuttle leaves from the north entrance every thirty minutes.',
    'Where does the airport shuttle leave from?',
    'How do I get a ride to my flight?',
  ],
  [
    'en',
    'The campus shuttle leaves from the east gate after the final lecture.',
    'Where does the campus shuttle leave from?',
    'Where can I catch the bus back to campus?',
  ],
  [
    'en',
    'Lost property is held by the reception desk near the library.',
    'Where is lost property held?',
    'I misplaced my coat. Who keeps found belongings?',
  ],
  [
    'en',
    'Library access requires a printed visitor pass issued by security.',
    'What is required for library access?',
    'Which badge lets me enter the reading room?',
  ],
];
function fixtureId(index) {
  return 'a360ba01-2551-4cf1-8f6d-' + index.toString().padStart(12, '0');
}
const round = (n) => Number(n.toFixed(3));

test('RU/KK/EN retrieval benchmark compares dense, BM25, RRF and reranked RRF', { timeout: 180_000 }, async (t) => {
  assert.ok(process.env.QDRANT_URL, 'QDRANT_URL required');
  const model = modelConfig();
  const config = { ...model, collection: 'openfacto_docs_' + randomBytes(8).toString('hex') };
  const url = new URL('/collections/' + config.collection, process.env.QDRANT_URL);
  const headers = process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {};
  assert.equal((await fetch(url, { headers })).status, 404);
  const event = { organizationId: fixtureId(900), eventId: fixtureId(901) };
  const docs = corpus.map(([language, text, ...questions], i) => {
    const scope = { ...event, documentId: fixtureId(i + 1), versionId: fixtureId(i + 101) };
    return { language, questions, scope, chunk: chunkPages(scope.versionId, [{ page: 1, text }])[0] };
  });
  const byId = new Map(docs.map((d) => [d.chunk.id, d.chunk]));
  const versions = docs.map((d) => d.scope.versionId);
  const results = [];
  await ensureCollection(config);
  try {
    for (const doc of docs)
      await upsert(config.collection, doc.scope, [doc.chunk], await dense([doc.chunk.text], config));
    for (const method of ['dense', 'lexical', 'hybrid', 'rerank']) {
      const queries = [];
      for (const doc of docs)
        for (const question of doc.questions) {
          let points = await candidates(event, versions, question, 16, method === 'rerank' ? 'hybrid' : method, config);
          if (method === 'rerank')
            points = points
              .map((p) => ({ ...p, score: rerank(question, byId.get(p.id).text, p.score) }))
              .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          const rank = points.slice(0, 3).findIndex((p) => p.id === doc.chunk.id) + 1;
          queries.push({ language: doc.language, rank });
        }
      for (const language of ['all', 'ru', 'kk', 'en']) {
        const sample = queries.filter((q) => language === 'all' || q.language === language);
        const mean = (fn) => round(sample.reduce((sum, q) => sum + fn(q.rank), 0) / sample.length);
        results.push({
          method,
          language,
          n: sample.length,
          precision1: mean((r) => Number(r === 1)),
          recall3: mean((r) => Number(r > 0)),
          mrr3: mean((r) => (r ? 1 / r : 0)),
          ndcg3: mean((r) => (r ? 1 / Math.log2(r + 1) : 0)),
        });
      }
    }
    assert.equal(results.length, 16);
    assert.ok(results.every((r) => r.ndcg3 >= 0 && r.ndcg3 <= 1));
    const configHash = createHash('sha256')
      .update(JSON.stringify({ model: model.collection, corpus, k: 3, prefetch: 16, ranking: 'term-coverage-0.75-v1' }))
      .digest('hex');
    t.diagnostic(JSON.stringify({ model: model.model, configHash, results }));
  } finally {
    assert.equal((await fetch(url, { method: 'DELETE', headers })).ok, true);
  }
});
