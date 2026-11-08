import { afterEach, describe, expect, it, vi } from 'vitest';
import { objectKey } from '../src/ingestion-storage.js';
import { candidates, chunkPages, dense, modelConfig, rerank, sparse } from '../src/ingestion-vectors.js';
import { processIngestionJob } from '../src/ingestion.js';

const organizationId = '10101010-0000-4000-8000-000000000001';
const eventId = '10101010-0000-4000-8000-000000000002';
const documentId = '10101010-0000-4000-8000-000000000003';
const versionId = '10101010-0000-4000-8000-000000000004';
const scope = { organizationId, eventId, documentId, versionId };

describe('private document indexing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('derives S3 keys only from validated IDs and rejects hostile jobs before SQL', async () => {
    expect(objectKey(scope)).toBe(`quarantine/${organizationId}/${eventId}/${documentId}/${versionId}.pdf`);
    expect(() => objectKey({ ...scope, documentId: '../foreign' })).toThrow('scope');
    await expect(
      processIngestionJob(null as never, { name: 'ingest', data: { url: 'file:///private.pdf' } }),
    ).rejects.toThrow('scope');
  });
  it('keeps stable point IDs and original page numbers across retries', () => {
    const pages = [{ page: 3, text: 'Открытие залында starts tomorrow. '.repeat(100) }];
    const chunks = chunkPages(versionId, pages);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.page === 3 && c.text.length <= 1000)).toBe(true);
    expect(new Set(chunks.map((c) => c.id)).size).toEqual(chunks.length);
    expect(chunkPages(versionId, pages)).toEqual(chunks);
    expect(chunkPages(documentId, pages)[0]?.id).not.toBe(chunks[0]?.id);
  });
  it('indexes multilingual terms and rewards matching evidence', async () => {
    for (const text of ['регистрация открыта', 'тіркеу ашық', 'registration open']) {
      expect(sparse(text).indices.length).toBe(2);
      expect((await dense([text]))[0]?.some((value) => value !== 0)).toBe(true);
      expect(rerank(text, text, 0.4)).toBeGreaterThan(rerank(text, 'unrelated', 0.9));
    }
  });
  it('puts tenant, event and allowed version filters on both retrieval branches', async () => {
    vi.stubEnv('QDRANT_URL', 'http://localhost:6333');
    const request = vi.fn().mockResolvedValue(Response.json({ result: { points: [] } }));
    vi.stubGlobal('fetch', request);
    await candidates(scope, [versionId], 'Кесте', 12);
    const body = JSON.parse(request.mock.calls[0]![1].body);
    const filter = {
      must: [
        { key: 'organizationId', match: { value: organizationId } },
        { key: 'eventId', match: { value: eventId } },
        { key: 'versionId', match: { any: [versionId] } },
      ],
    };
    expect(body.filter).toEqual(filter);
    expect(body.prefetch.map((b: { filter: unknown }) => b.filter)).toEqual([filter, filter]);
    expect(body.query.fusion).toBe('rrf');
  });
});

describe('pinning loopback semantic models', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  function localModel() {
    vi.stubEnv('EMBEDDING_URL', 'http://127.0.0.1:7312/v1/embeddings');
    vi.stubEnv('EMBEDDING_MODEL', 'fixture-model');
    vi.stubEnv('EMBEDDING_REVISION', 'sha256-fixture-1');
    vi.stubEnv('EMBEDDING_DIMENSIONS', '8');
  }
  it('separates model revisions and prevents remote or credential-bearing URLs', () => {
    localModel();
    const first = modelConfig();
    vi.stubEnv('EMBEDDING_REVISION', 'sha256-fixture-2');
    expect(modelConfig().collection).not.toBe(first.collection);
    for (const url of [
      'https://provider.example/v1/embeddings',
      'http://abc:secret@127.0.0.1/v1/embeddings',
      'http://127.0.0.1/v1/files',
    ]) {
      vi.stubEnv('EMBEDDING_URL', url);
      expect(() => modelConfig()).toThrow();
    }
  });
  it('rejects incorrectly shaped, zero and mismatched model vectors', async () => {
    localModel();
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    for (const [model, embedding] of [
      ['incorrect', Array(8).fill(1)],
      ['fixture-model', [1]],
      ['fixture-model', Array(8).fill(0)],
    ]) {
      request.mockResolvedValueOnce(Response.json({ model, data: [{ index: 0, embedding }] }));
      await expect(dense(['text'])).rejects.toThrow();
    }
    expect(request.mock.calls[0]![1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
