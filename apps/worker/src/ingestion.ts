import { createHash, randomUUID } from 'node:crypto';
import type { IngestionQueue } from './ingestion-queue.js';
import type postgres from 'postgres';
import { materializeFaq, sweepFaqEmbeddings } from './ingestion-faq.js';
import { interleaveDocumentHits } from './retrieval-ranking.js';
import {
  deleteOriginal,
  documentScope,
  readOriginal,
  type DocumentScope,
  type EventScope,
} from './ingestion-storage.js';
import {
  candidates,
  chunkPages,
  dense,
  ensureCollection,
  modelConfig,
  purgeVectors,
  rerank,
  upsert,
  type Page,
} from './ingestion-vectors.js';

export {
  deleteOriginal,
  putOriginal,
  readOriginal,
  MAX_PDF_BYTES,
  type DocumentScope,
  type EventScope,
} from './ingestion-storage.js';

export { rankScopedFaqCandidates } from './ingestion-faq.js';
export const INGESTION_QUEUE = 'documents.ingest';
type Sql = postgres.Sql;
type Reader = Sql | postgres.TransactionSql;
type Mode = 'published' | 'draft_preview';
type ScopeRow = { organization_id: string; event_id: string; source_id: string; version_id: string };

type PageDiagnostic = { page: number; status: 'needs_text' | 'needs_ocr' };
class RejectedPdf extends Error {
  constructor(
    message: string,
    readonly diagnostics: PageDiagnostic[] = [],
  ) {
    super(message);
  }
}

function parseDiagnostics(pageCount: number, rows: unknown): PageDiagnostic[] {
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > 300 ||
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > pageCount
  )
    throw new Error('Invalid parser diagnostics');
  let previous = 0;
  return rows.map((row) => {
    if (
      !row ||
      !Number.isInteger(row.page) ||
      row.page <= previous ||
      row.page > pageCount ||
      !['needs_ocr', 'needs_text'].includes(row.status)
    )
      throw new Error('Invalid parser diagnostics');
    previous = row.page;
    return { page: row.page, status: row.status };
  });
}
async function parseOriginal(scope: DocumentScope, digest: string): Promise<Page[]> {
  const bytes = await readOriginal(scope);
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new RejectedPdf('Invalid PDF checksum');
  const token = process.env.PDF_WORKER_TOKEN;
  if (!token || token.length < 32) throw new Error('PDF worker unavailable');
  const url = new URL('/v1/extract', process.env.PDF_WORKER_URL || 'http://127.0.0.1:8001');
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(32_000),
    headers: { 'Content-Type': 'application/pdf', Authorization: 'Bearer ' + token },
    body: new Uint8Array(bytes),
  });
  if (response.status === 422) {
    const failure = await response.json();
    if (failure?.code === 'PDF_PAGES_NEED_TEXT') {
      throw new RejectedPdf('Unreadable PDF pages', parseDiagnostics(failure.pageCount, failure.pageDiagnostics));
    }
    throw new RejectedPdf('PDF rejected');
  }
  if ([408, 413, 415].includes(response.status)) throw new RejectedPdf('PDF rejected');
  if (!response.ok) throw new Error('PDF worker unavailable');
  const { pages, pageCount } = (await response.json()) as { pages: Page[]; pageCount: number };
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.length > 300 ||
    pages.length !== pageCount ||
    pages.some((p, index) => p.page !== index + 1 || typeof p.text !== 'string' || !p.text.trim()) ||
    pages.reduce((sum, p) => sum + p.text.length, 0) > 2_000_000
  )
    throw new Error('Invalid parser response');
  return pages;
}

function fromRow(row: ScopeRow): DocumentScope {
  return {
    organizationId: row.organization_id,
    eventId: row.event_id,
    documentId: row.source_id,
    versionId: row.version_id,
  };
}

export async function scheduleModelReindex(sql: Sql) {
  // Explicit migration: don't let concurrent workers using different models requeue each other's documents.
  const config = modelConfig();
  return sql`update source_versions v set ingestion_status='pending',ingestion_attempts=0,ingestion_available_at=now()
    from knowledge_sources s where (v.organization_id,v.event_id,v.source_id,v.id)=
      (s.organization_id,s.event_id,s.id,s.published_version_id)
    and v.original_sha256 is not null and v.ingestion_status='ready' and v.visibility='participant'
    and not (${config.collection}=any(v.index_collections)) returning v.id`;
}
export async function sweepIngestion(sql: Sql, queue: IngestionQueue) {
  // The upload intent predates object storage. A crash between PUT and commit still leaves a purgeable key.
  await sql`delete from source_versions where ingestion_status='uploading' and created_at < now()-interval '1 hour'`;
  const due = await sql<ScopeRow[]>`select organization_id,event_id,source_id,id as version_id from source_versions
    where ingestion_status in ('pending','processing') and ingestion_available_at <= now()
    and not exists(select 1 from queue_dispatches d where d.queue='documents.ingest' and d.name='ingest'
      and d.job_id=source_versions.id and d.available_at>now())
    order by ingestion_available_at,id limit 64`;
  const garbage = await sql<ScopeRow[]>`select * from document_purges where available_at <= now()
    and not exists(select 1 from queue_dispatches d where d.queue='documents.ingest' and d.name='purge'
      and d.job_id=document_purges.version_id and d.available_at>now())
    order by available_at,version_id limit 64`;
  for (const [name, rows] of [
    ['ingest', due],
    ['purge', garbage],
  ] as const) {
    for (const row of rows) {
      await queue.add(name, fromRow(row), {
        jobId: name + '-' + row.version_id,
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
  }
  await sweepFaqEmbeddings(sql, queue);
}

async function purge(sql: Sql, scope: DocumentScope) {
  const { organizationId, eventId, documentId, versionId } = scope;
  const [intent] = await sql<
    { index_collections: string[] }[]
  >`update document_purges set available_at=now()+interval '1 minute'
    where organization_id=${organizationId} and event_id=${eventId} and source_id=${documentId}
      and version_id=${versionId} and available_at <= now() returning index_collections`;
  if (!intent) return;
  for (const collection of intent.index_collections) await purgeVectors(collection, scope);
  await deleteOriginal(scope);
  await sql`delete from document_purges where organization_id=${organizationId} and event_id=${eventId}
    and source_id=${documentId} and version_id=${versionId}`;
}

async function ingest(sql: Sql, scope: DocumentScope) {
  const { organizationId, eventId, documentId, versionId } = scope;
  const config = modelConfig();
  const claim = randomUUID();
  const [version] = await sql<{ original_sha256: string | null; body: string; ingestion_attempts: number }[]>`
    update source_versions v set ingestion_status='processing', ingestion_claim=${claim},
      ingestion_attempts=ingestion_attempts+1, ingestion_available_at=now()+interval '10 minutes',
      index_collections=case when ${config.collection}=any(index_collections) then index_collections
        else array_append(index_collections,${config.collection}) end
    from knowledge_sources s where v.organization_id=${organizationId} and v.event_id=${eventId}
      and v.source_id=${documentId} and v.id=${versionId} and v.ingestion_status in ('pending','processing')
      and v.ingestion_available_at <= now() and (s.organization_id,s.event_id,s.id)=(v.organization_id,v.event_id,v.source_id)
      and s.kind='document' returning v.original_sha256,v.body,v.ingestion_attempts`;
  if (!version) return;
  try {
    const pages = version.original_sha256
      ? await parseOriginal(scope, version.original_sha256)
      : [{ page: 1, text: version.body }];
    const chunks = chunkPages(versionId, pages);
    if (!chunks.length || chunks.length > 2500) throw new RejectedPdf('Unreadable document');
    await ensureCollection(config);
    await sql.begin(async (tx) => {
      // Hold the same row deletion cascades lock until all external writes finish. Purge then runs after upsert.
      const [owned] =
        await tx`select id from source_versions where organization_id=${organizationId} and event_id=${eventId}
        and source_id=${documentId} and id=${versionId} and ingestion_claim=${claim} for update`;
      if (!owned) return;
      await tx`delete from source_chunks where organization_id=${organizationId} and event_id=${eventId}
        and source_id=${documentId} and version_id=${versionId}`;
      for (let start = 0; start < chunks.length; start += 64) {
        const batch = chunks.slice(start, start + 64);
        const vectors = await dense(
          batch.map((c) => c.text),
          config,
        );
        await upsert(config.collection, scope, batch, vectors);
        const rows = batch.map((c) => ({
          id: c.id,
          organization_id: organizationId,
          event_id: eventId,
          source_id: documentId,
          version_id: versionId,
          ordinal: c.ordinal,
          page: c.page,
          body: c.text,
        }));
        await tx`insert into source_chunks ${tx(rows)}`;
      }
      await tx`update source_versions set ingestion_status='ready',ingestion_claim=null,page_diagnostics='[]'::jsonb where id=${versionId} and ingestion_claim=${claim}`;
    });
  } catch (error) {
    const status = error instanceof RejectedPdf || version.ingestion_attempts >= 5 ? 'failed' : 'pending';
    const diagnostics = error instanceof RejectedPdf ? error.diagnostics : [];
    await sql`update source_versions set ingestion_status=${status},ingestion_claim=null,page_diagnostics=${sql.json(diagnostics)},
      ingestion_available_at=now()+${Math.min(300, 2 ** version.ingestion_attempts)}*interval '1 second'
      where organization_id=${organizationId} and event_id=${eventId} and source_id=${documentId} and id=${versionId} and ingestion_claim=${claim}`;
    throw new Error(status === 'failed' ? 'Document ingestion failed' : 'Document ingestion deferred');
  }
}

export async function processIngestionJob(sql: Sql, job: { name: string; data: unknown }) {
  const scope = documentScope(job.data);
  if (job.name === 'embed-faq') return materializeFaq(sql, scope, (job.data as { modelKey?: unknown }).modelKey);
  if (job.name === 'ingest') return ingest(sql, scope);
  if (job.name === 'purge') return purge(sql, scope);
  throw new Error('Unsupported ingestion job');
}

function allowedVersions(sql: Reader, scope: EventScope, mode: Mode) {
  const eligible =
    mode === 'draft_preview'
      ? sql`v.id=(select vv.id from source_versions vv where vv.source_id=s.id and vv.event_id=s.event_id
        and vv.organization_id=s.organization_id and vv.ingestion_status='ready' order by vv.number desc limit 1)`
      : sql`v.id=s.published_version_id`;
  return sql`select v.id from source_versions v join knowledge_sources s
    on (s.organization_id,s.event_id,s.id)=(v.organization_id,v.event_id,v.source_id)
    where v.organization_id=${scope.organizationId} and v.event_id=${scope.eventId} and s.kind='document'
      and v.visibility='participant' and v.ingestion_status='ready'
      and ${modelConfig().collection}=any(v.index_collections) and ${eligible}`;
}

export interface DocumentHit {
  sourceId: string;
  versionId: string;
  title: string;
  language: 'ru' | 'kk' | 'en';
  page: number;
  text: string;
  score: number;
  chunkId: string;
}

export async function searchDocuments(
  sql: Reader,
  scope: EventScope,
  question: string,
  limit = 6,
  mode: Mode = 'published',
): Promise<DocumentHit[]> {
  if (!question.trim() || question.length > 4000) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error('Invalid search limit');
  const versions = await allowedVersions(sql, scope, mode);
  if (!versions.length) return [];
  const hits = await candidates(
    scope,
    versions.map((v) => String(v.id)),
    question,
    Math.max(16, limit * 3),
  );
  // Russian stemming complements multilingual dense search. Event-name words
  // occur on every page and must not drown out a specific term such as апелляция.
  // Query terms are already stemmed: parse with simple to avoid stemming them twice.
  const lexical = await sql<{ id: string; score: number }[]>`
    WITH terms AS (
      SELECT unnest(tsvector_to_array(to_tsvector('russian',${question}))) AS term
      EXCEPT SELECT unnest(tsvector_to_array(to_tsvector('russian',name))) FROM events
        WHERE organization_id=${scope.organizationId} AND id=${scope.eventId}
    ),q AS (SELECT to_tsquery('simple',string_agg(quote_literal(term) ||
      CASE WHEN length(term)>=6 AND term ~ '^[а-яё]+$'
        THEN ' | ' || quote_literal(left(term,length(term)-2)) || ':*' ELSE '' END,' | ')) AS query FROM terms)
    SELECT c.id,ts_rank_cd(to_tsvector('russian',c.body),q.query) AS score FROM source_chunks c CROSS JOIN q
    WHERE c.organization_id=${scope.organizationId} AND c.event_id=${scope.eventId}
      AND c.version_id IN ${sql(versions.map(v=>String(v.id)))}
      AND to_tsvector('russian',c.body) @@ q.query
    ORDER BY score DESC,c.id LIMIT 12`;
  if (!hits.length && !lexical.length) return [];
  const ranks = new Map(hits.map((hit) => [hit.id, hit.score]));
  for (const hit of lexical) if (!ranks.has(hit.id)) ranks.set(hit.id, 0);
  // Recheck publication and ACL after Qdrant. Only SQL supplies user-visible text.
  const rows = await sql<
    {
      source_id: string;
      version_id: string;
      title: string;
      language: DocumentHit['language'];
      page: number;
      body: string;
      id: string;
    }[]
  >`
    select c.source_id,c.version_id,v.title,v.language,c.page,
      concat_ws(E'\n\n',prev.body,c.body,nxt.body) as body,c.id from source_chunks c join source_versions v
      on (v.organization_id,v.event_id,v.source_id,v.id)=(c.organization_id,c.event_id,c.source_id,c.version_id)
    left join source_chunks prev on (prev.organization_id,prev.event_id,prev.source_id,prev.version_id,prev.page,prev.ordinal)=
      (c.organization_id,c.event_id,c.source_id,c.version_id,c.page,c.ordinal-1)
    left join source_chunks nxt on (nxt.organization_id,nxt.event_id,nxt.source_id,nxt.version_id,nxt.page,nxt.ordinal)=
      (c.organization_id,c.event_id,c.source_id,c.version_id,c.page,c.ordinal+1)
    where c.organization_id=${scope.organizationId} and c.event_id=${scope.eventId} and c.id in ${sql([...ranks.keys()])}
      and v.id in (${allowedVersions(sql, scope, mode)})`;
  const ranked = rows
    .map((row) => ({
      sourceId: row.source_id,
      versionId: row.version_id,
      title: row.title,
      language: row.language,
      page: row.page,
      text: row.body,
      score: rerank(question, row.body, ranks.get(row.id) ?? 0),
      chunkId: row.id,
    }))
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  const byId = new Map(ranked.map(row => [row.chunkId, { ...row, id: row.chunkId }]));
  const lexicalRows = lexical.flatMap(hit => {
    const row = byId.get(hit.id);
    return row ? [row] : [];
  });
  return interleaveDocumentHits([...byId.values()], lexicalRows, limit);
}
