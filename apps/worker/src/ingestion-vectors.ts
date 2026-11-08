import { createHash } from 'node:crypto';
import type { DocumentScope, EventScope } from './ingestion-storage.js';
import { CHUNK_REVISION, type Chunk } from './document-chunks.js';
export { chunkPages, type Chunk, type Page } from './document-chunks.js';

const tokens = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function sparse(text: string, query = false) {
  const words = tokens(text);
  const counts = new Map<number, number>();
  for (const word of words) {
    const id = hash(word);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const indices = [...counts.keys()].sort((a, b) => a - b);
  // BM25 term saturation. Qdrant applies collection IDF to queries.
  const norm = 1.2 * (0.25 + (0.75 * words.length) / 150);
  return {
    indices,
    values: indices.map((id) => {
      const tf = counts.get(id)!;
      return query ? 1 : (tf * 2.2) / (tf + norm);
    }),
  };
}

export function modelConfig() {
  const { EMBEDDING_URL, EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_DIMENSIONS } = process.env;
  if (!EMBEDDING_URL)
    return { model: 'local-char-trigrams-v1', dimensions: 256, collection: 'openfacto_docs_5ae14785252faf80' };
  const url = new URL(EMBEDDING_URL);
  const dimensions = Number(EMBEDDING_DIMENSIONS);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/v1/embeddings' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !EMBEDDING_MODEL?.trim() ||
    !EMBEDDING_REVISION?.trim() ||
    !Number.isInteger(dimensions) ||
    dimensions < 8 ||
    dimensions > 4096
  ) {
    throw new Error('Invalid loopback embedding configuration');
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([EMBEDDING_MODEL, EMBEDDING_REVISION, dimensions, CHUNK_REVISION, 'query-passage-v1']))
    .digest('hex')
    .slice(0, 16);
  return { url: url.href, model: EMBEDDING_MODEL, revision: EMBEDDING_REVISION, dimensions, collection: 'openfacto_docs_' + fingerprint };
}

function localFeatures(text: string, dimensions: number) {
  const vector = Array<number>(dimensions).fill(0);
  for (const word of tokens(text)) {
    const padded = '^' + word + '$';
    for (let i = 0; i < padded.length - 2; i++) {
      const feature = hash(padded.slice(i, i + 3));
      const index = feature % dimensions;
      vector[index] = vector[index]! + (feature > 0x7fffffff ? 1 : -1);
    }
  }
  return vector;
}

async function readEmbeddings(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Local embedding endpoint unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Embedding response exceeds limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function dense(texts: string[], config = modelConfig(), inputType: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  if (texts.length > 64 || texts.some((t) => t.length > 4000)) throw new Error('Embedding batch exceeds limit');
  if (!config.url) return texts.map((text) => localFeatures(text, config.dimensions));
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 16) {
    const input = texts.slice(start, start + 16);
    const response = await fetch(config.url, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ model: config.model, revision: config.revision, input, input_type: inputType, encoding_format: 'float' }),
    });
    const result = (await readEmbeddings(response, 8192 + input.length * config.dimensions * 32)) as {
      model?: string;
      data?: { index: number; embedding: number[] }[];
    };
    if (result?.model !== config.model || !Array.isArray(result.data) || result.data.length !== input.length)
      throw new Error('Embedding model mismatch');
    result.data.sort((a, b) => a.index - b.index);
    for (const [i, row] of result.data.entries()) {
      if (
        row.index !== i ||
        !Array.isArray(row.embedding) ||
        row.embedding.length !== config.dimensions ||
        !row.embedding.some((x) => x !== 0) ||
        row.embedding.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e10)
      ) {
        throw new Error('Invalid local embedding');
      }
      vectors.push(row.embedding);
    }
  }
  return vectors;
}

async function vectorRequest(collection: string, path: string, method: string, body?: unknown) {
  if (!/^openfacto_docs_[0-9a-f]{16}$/.test(collection) || !process.env.QDRANT_URL)
    throw new Error('Invalid vector store configuration');
  const url = new URL(`/collections/${collection}${path}`, process.env.QDRANT_URL);
  const key = process.env.QDRANT_API_KEY;
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'api-key': key } : {}) },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function ensureCollection(config: ReturnType<typeof modelConfig>) {
  const info = await vectorRequest(config.collection, '', 'GET');
  let existing: Record<string, unknown> = {};
  if (info.ok) {
    const { result } = (await info.json()) as {
      result: { payload_schema: Record<string, unknown>; config: { params: { vectors: { dense: { size: number } } } } };
    };
    if (result.config.params.vectors.dense?.size !== config.dimensions)
      throw new Error('Incompatible vector collection');
    existing = result.payload_schema;
  } else {
    await info.body?.cancel();
    if (info.status !== 404) throw new Error('Vector store unavailable');
    const created = await vectorRequest(config.collection, '', 'PUT', {
      vectors: { dense: { size: config.dimensions, distance: 'Cosine' } },
      sparse_vectors: { lexical: { modifier: 'idf' } },
    });
    await created.body?.cancel();
    if (!created.ok && created.status !== 409) throw new Error('Vector collection unavailable');
  }
  for (const field_name of ['organizationId', 'eventId', 'documentId', 'versionId']) {
    if (existing[field_name]) continue;
    const response = await vectorRequest(config.collection, '/index?wait=true', 'PUT', {
      field_name,
      field_schema: 'uuid',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Vector index unavailable');
  }
}

function eventConditions(scope: EventScope) {
  return ['organizationId', 'eventId'].map((key) => ({ key, match: { value: scope[key as keyof EventScope] } }));
}
export async function upsert(collection: string, scope: DocumentScope, chunks: Chunk[], vectors: number[][]) {
  const result = await vectorRequest(collection, '/points?wait=true', 'PUT', {
    points: chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: { dense: vectors[i], lexical: sparse(chunk.text) },
      payload: { ...scope, page: chunk.page, ordinal: chunk.ordinal },
    })),
  });
  await result.body?.cancel();
  if (!result.ok) throw new Error('Vector upsert unavailable');
}

export async function purgeVectors(collection: string, scope: DocumentScope) {
  const must = Object.entries(scope).map(([key, value]) => ({ key, match: { value } }));
  const result = await vectorRequest(collection, '/points/delete?wait=true', 'POST', { filter: { must } });
  await result.body?.cancel();
  if (!result.ok && result.status !== 404) throw new Error('Vector delete unavailable');
}

export async function candidates(
  scope: EventScope,
  versions: string[],
  question: string,
  count: number,
  method: 'dense' | 'lexical' | 'hybrid' = 'hybrid',
  config = modelConfig(),
) {
  const filter = { must: [...eventConditions(scope), { key: 'versionId', match: { any: versions } }] };
  const lexical = sparse(question, true);
  if (!lexical.indices.length) return [];
  const embedding = method === 'lexical' ? undefined : (await dense([question], config, 'query'))[0];
  const search =
    method === 'hybrid'
      ? {
          prefetch: [
            { using: 'dense', query: embedding, filter, limit: count },
            { using: 'lexical', query: lexical, filter, limit: count },
          ],
          query: { fusion: 'rrf' },
        }
      : { using: method, query: method === 'lexical' ? lexical : embedding };
  const result = await vectorRequest(config.collection, '/points/query', 'POST', {
    ...search,
    filter,
    limit: count,
    with_payload: false,
  });
  if (!result.ok) {
    await result.body?.cancel();
    throw new Error('Document search unavailable');
  }
  const points = ((await result.json()) as { result: { points: { id: string; score: number }[] } }).result.points;
  return points;
}

export function rerank(question: string, body: string, fused: number) {
  const wanted = new Set(tokens(question));
  const have = new Set(tokens(body));
  const matched = [...wanted].filter((word) => have.has(word)).length;
  return 0.75 * (matched / Math.max(1, wanted.size)) + 0.25 * Math.max(0, Math.min(1, fused));
}
