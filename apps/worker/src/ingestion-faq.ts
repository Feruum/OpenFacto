import { randomUUID } from 'node:crypto';
import type { IngestionQueue } from './ingestion-queue.js';
import type postgres from 'postgres';
import type { DocumentScope, EventScope } from './ingestion-storage.js';
import { dense, modelConfig, rerank } from './ingestion-vectors.js';

type Reader = postgres.Sql | postgres.TransactionSql;
type Mode = 'published' | 'draft_preview';
type ScopeRow = { organization_id: string; event_id: string; source_id: string; version_id: string };
type AuthorizedFaq = {
  sourceId: string;
  versionId: string;
  organizationId: string;
  eventId: string;
  title: string;
  aliases: readonly string[];
  visibility: string;
  kind: string;
  state: string;
};

const faqText = (title: string, aliases: readonly string[]) => [title, ...aliases].join('\n').slice(0, 4000);
const modelKey = (config: ReturnType<typeof modelConfig>) => 'faq-title-alias-v1/' + config.collection;
function normalized(vector: number[]) {
  const norm = Math.hypot(...vector);
  return norm ? vector.map((value) => value / norm) : vector;
}

// A version is immutable. Publishing, rollback and model changes all use the same cache-miss scan.
export async function sweepFaqEmbeddings(sql: postgres.Sql, queue: IngestionQueue) {
  const config = modelConfig();
  const key = modelKey(config);
  const due = await sql<ScopeRow[]>`select v.organization_id,v.event_id,v.source_id,v.id as version_id
    from knowledge_sources s join source_versions v
      on (v.organization_id,v.event_id,v.source_id,v.id)=(s.organization_id,s.event_id,s.id,s.published_version_id)
    left join faq_embeddings f on (f.version_id,f.model_key)=(v.id,${key})
    where s.kind='faq' and v.visibility='participant' and f.embedding is null and coalesce(f.available_at,v.created_at)<=now()
    and not exists(select 1 from queue_dispatches d where d.queue='documents.ingest' and d.name='embed-faq'
      and d.job_id=v.id and d.available_at>now())
    order by coalesce(f.available_at,v.created_at),v.id limit 32`;
  for (const row of due) {
    const data = {
      organizationId: row.organization_id,
      eventId: row.event_id,
      documentId: row.source_id,
      versionId: row.version_id,
      modelKey: key,
    };
    await queue.add('embed-faq', data, {
      jobId: 'embed-faq-' + row.version_id + '-' + config.collection,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}

export async function materializeFaq(sql: postgres.Sql, scope: DocumentScope, expectedKey: unknown) {
  const config = modelConfig();
  const key = modelKey(config);
  if (expectedKey !== key) return;
  const token = randomUUID();
  const { organizationId, eventId, documentId, versionId } = scope;
  // Take a lease only if this exact version is still published for this event.
  const [version] = await sql<{ title: string; aliases: string[] }[]>`with live as (
    select v.* from source_versions v join knowledge_sources s
      on (s.organization_id,s.event_id,s.id,s.published_version_id)=(v.organization_id,v.event_id,v.source_id,v.id)
    where (v.organization_id,v.event_id,v.source_id,v.id)=(${organizationId},${eventId},${documentId},${versionId})
      and s.kind='faq' and v.visibility='participant'
  ), claimed as (
    insert into faq_embeddings(organization_id,event_id,source_id,version_id,model_key,claim_token,available_at,attempts)
    select organization_id,event_id,source_id,id,${key},${token},now()+interval '2 minutes',1 from live
    on conflict(version_id,model_key) do update set claim_token=excluded.claim_token,available_at=excluded.available_at,
      attempts=faq_embeddings.attempts+1
      where faq_embeddings.embedding is null and faq_embeddings.available_at<=now()
    returning version_id)
    select l.title,l.aliases from live l join claimed c on c.version_id=l.id`;
  if (!version) return;
  try {
    const [vector] = await dense([faqText(version.title, version.aliases)], config);
    await sql`update faq_embeddings f set embedding=${sql.array(normalized(vector!))}::real[],claim_token=null
      from knowledge_sources s where (f.organization_id,f.event_id,f.source_id,f.version_id)=(${organizationId},${eventId},${documentId},${versionId})
      and (s.organization_id,s.event_id,s.id,s.published_version_id)=(f.organization_id,f.event_id,f.source_id,f.version_id)
      and f.model_key=${key} and f.claim_token=${token}`;
  } catch {
    await sql`update faq_embeddings set claim_token=null,available_at=now()+least(900,15*attempts)*interval '1 second'
      where (organization_id,event_id,source_id,version_id,model_key,claim_token)=(${organizationId},${eventId},${documentId},${versionId},${key},${token})`;
    throw new Error('FAQ embedding deferred');
  }
}

export async function rankScopedFaqCandidates<T extends AuthorizedFaq>(
  sql: Reader,
  scope: EventScope,
  question: string,
  authorizedFaqRows: readonly T[],
  limit = 8,
  mode: Mode = 'published',
): Promise<{ source: T; score: number }[]> {
  if (!question.trim() || question.length > 4000) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error('Invalid FAQ limit');
  const draft = mode === 'draft_preview';
  const authorized = new Map(
    authorizedFaqRows
      .filter(
        (r) =>
          r.organizationId === scope.organizationId &&
          r.eventId === scope.eventId &&
          r.visibility === 'participant' &&
          r.kind === 'faq' &&
          (r.state === 'published' || (draft && r.state === 'draft')),
      )
      .map((r) => [r.versionId, r]),
  );
  if (!authorized.size) return [];
  const config = modelConfig();
  // One query embedding, independent of the number of published versions. On outage the selector still receives lexical candidates.
  let query: number[] = [];
  try {
    query = normalized((await dense([question], config, 'query'))[0]!);
  } catch {
    /* Local inference unavailable. */
  }
  const sourceIds = [...new Set([...authorized.values()].map((r) => r.sourceId))];
  const rows = await sql<{ source_id: string; version_id: string; similarity: number | null }[]>`
    select s.id as source_id,
      ${draft ? sql`md5(s.id::text || s.updated_at::text)::uuid` : sql`v.id`} as version_id,
      case when f.embedding is not null and ${query.length}::integer=cardinality(f.embedding) then
        (select sum(x::double precision * y::double precision) from unnest(f.embedding,${sql.array(query)}::real[]) as d(x,y))
      end as similarity
    from knowledge_sources s left join source_versions v
      on (v.organization_id,v.event_id,v.source_id,v.id)=(s.organization_id,s.event_id,s.id,s.published_version_id)
    left join faq_embeddings f on (f.organization_id,f.event_id,f.source_id,f.version_id)=(s.organization_id,s.event_id,s.id,v.id)
      and f.model_key=${modelKey(config)} and v.visibility='participant'
      ${draft ? sql`and v.title=s.title and v.aliases=s.aliases` : sql``}
    where (s.organization_id,s.event_id)=(${scope.organizationId},${scope.eventId}) and s.id=any(${sql.array(sourceIds)}::uuid[]) and s.kind='faq'
      and ${draft ? sql`s.visibility='participant' and length(s.body)>0` : sql`v.visibility='participant'`}`;
  const hits: { source: T; score: number }[] = [];
  for (const row of rows) {
    const source = authorized.get(row.version_id);
    if (!source || source.sourceId !== row.source_id) continue;
    const lexical = rerank(question, faqText(source.title, source.aliases), 0) / 0.75;
    hits.push({ source, score: 0.7 * Math.max(0, Math.min(1, Number(row.similarity ?? 0))) + 0.3 * lexical });
  }
  return hits.sort((a, b) => b.score - a.score || a.source.sourceId.localeCompare(b.source.sourceId)).slice(0, limit);
}
