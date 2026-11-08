import type postgres from 'postgres';
import { AnswerEngine, ServiceFailure, type AnswerInput, type EvidenceRef } from '@openfacto/answer-engine';
import { loadEvidence, type Query } from '@openfacto/database';
import { rankScopedFaqCandidates, searchDocuments } from './ingestion.js';
import { chunkPages, rerank } from './ingestion-vectors.js';
import { providerPorts } from './provider.js';
import { mergeRanks,mergeQueryRanks } from './retrieval-ranking.js';
import { semanticRerank } from './semantic-reranker.js';
import {VerifiedAnswerCache,answerCacheKey} from './answer-cache.js';
import {createHash} from 'node:crypto';

const answerCaches=new WeakMap<postgres.Sql,VerifiedAnswerCache>();

export async function liveReferencesCurrent(
  sql: Query,
  organizationId: string,
  eventId: string,
  refs: EvidenceRef[],
) {
  if (!refs.length) return true;
  const found = await sql`SELECT s.id,s.published_version_id FROM knowledge_sources s JOIN source_versions v
    ON (v.organization_id,v.event_id,v.source_id,v.id)=(s.organization_id,s.event_id,s.id,s.published_version_id)
    WHERE s.organization_id=${organizationId} AND s.event_id=${eventId} AND v.visibility='participant'
      AND s.id IN ${sql(refs.map((ref) => ref.sourceId))}`;
  return refs.every((ref) =>
    found.some((row) => row.id === ref.sourceId && row.published_version_id === ref.versionId),
  );
}

export async function runScopedAnswer(sql: postgres.Sql, input: Omit<AnswerInput, 'sources'>) {
  if (!input.activated || !['live','published_preview'].includes(input.mode) || process.env.AI_RESPONSE_CACHE==='0')
    return generateScopedAnswer(sql,input);
  const snapshot=async()=>JSON.stringify(await sql`SELECT s.id,s.published_version_id,v.visibility,v.ingestion_status
    FROM knowledge_sources s JOIN source_versions v ON
    (v.organization_id,v.event_id,v.source_id,v.id)=(s.organization_id,s.event_id,s.id,s.published_version_id)
    WHERE s.organization_id=${input.organizationId} AND s.event_id=${input.eventId} ORDER BY s.id`);
  const revision=await snapshot();
  const policy=createHash('sha256').update(JSON.stringify(['verified-cache-v4',...[
    'AI_CHAT_ENDPOINT','AI_CHAT_MODEL','AI_VERIFY_MODEL','AI_REASONING_EFFORT','AI_THINKING_MODE','AI_COMPACT_OUTPUT','AI_COMBINED_PLANNING','EMBEDDING_URL','EMBEDDING_MODEL','EMBEDDING_REVISION',
    'RERANK_URL','RERANK_MODEL','RERANK_REVISION',
  ].map(name=>[name,process.env[name]??''])])).digest('hex');
  let cache=answerCaches.get(sql);
  if(!cache){cache=new VerifiedAnswerCache();answerCaches.set(sql,cache);}
  return cache.run(answerCacheKey(input,revision,policy),input.traceId,()=>generateScopedAnswer(sql,input),
    async decision=>(await snapshot())===revision&&await liveReferencesCurrent(sql,input.organizationId,input.eventId,decision.sources));
}

async function generateScopedAnswer(sql: postgres.Sql, input: Omit<AnswerInput, 'sources'>) {
  if (!input.activated) return AnswerEngine.run({ ...input, sources: [] });
  const draft = input.mode === 'draft_preview';
  const faqs = await loadEvidence(sql, input.organizationId, input.eventId, draft, 'faq');
  const model = providerPorts(sql, input);
  return AnswerEngine.run(
    { ...input, sources: faqs },
    {
      ...model,
      ...(process.env.RERANK_URL ? { rerank: async (i, candidates) => semanticRerank(i.question, candidates) } : {}),
      current: async (refs) => {
        if (!draft) return liveReferencesCurrent(sql, input.organizationId, input.eventId, refs);
        const rows = await loadEvidence(sql, input.organizationId, input.eventId, true, undefined, refs.map(ref=>ref.sourceId));
        return refs.every((ref) => rows.some((e) => e.sourceId === ref.sourceId && e.versionId === ref.versionId));
      },
      retrieve: async (interpreted) => {
        const queries = (interpreted.searchQueries ?? [input.question]).slice(0, 4);
        const text = input.faqOnly
          ? []
          : await loadEvidence(sql, input.organizationId, input.eventId, draft, 'text_document');
        const passages = text
          .flatMap((e) =>
            chunkPages(e.versionId, [{ page: 1, text: e.text }]).map((chunk) => ({
              ...e,
              text: chunk.text,
              section: (e.section ?? 'Text') + ' · ' + (chunk.ordinal + 1),
              score: Math.max(...queries.map(query => rerank(query, e.title + ' ' + chunk.text, 0))),
            })),
          )
          .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
          .slice(0, 5);
        const scope = { organizationId: input.organizationId, eventId: input.eventId };
        const faqSearch = async () => {
          try {
            return mergeRanks(await Promise.all(queries.map(async query => (
            await rankScopedFaqCandidates(
              sql,
              scope,
              query,
              faqs,
              5,
              draft ? 'draft_preview' : 'published',
            )
            ).map((hit) => hit.source))));
          } catch {
            throw new ServiceFailure('provider_unavailable');
          }
        };
        const documentSearch = async () => {
        const [pdf] = input.faqOnly
          ? []
          : await sql`SELECT 1 FROM source_versions v JOIN knowledge_sources s ON
        (v.organization_id,v.event_id,v.source_id)=(s.organization_id,s.event_id,s.id)
        WHERE v.organization_id=${scope.organizationId} AND v.event_id=${scope.eventId}
        AND v.original_sha256 IS NOT NULL AND v.ingestion_status='ready' AND v.visibility='participant'
        AND (${draft} OR s.published_version_id=v.id) LIMIT 1`;
        let docs: Awaited<ReturnType<typeof searchDocuments>> = [];
        if (pdf) {
          try {
            docs = mergeQueryRanks(await Promise.all(queries.map(query =>
              searchDocuments(sql, scope, query, 6, draft ? 'draft_preview' : 'published'))));
          } catch {
            throw new ServiceFailure('provider_unavailable');
          }
        }
        return docs;
        };
        // FAQ and PDF retrieval are independent; retain all original scope and publication checks.
        const [rankedFaq,docs] = await Promise.all([faqSearch(),documentSearch()]);
        const pages = docs.map((d) => ({
            ...scope,
            ...d,
            kind: 'document' as const,
            aliases: [],
            state: draft ? ('draft' as const) : ('published' as const),
            visibility: 'participant' as const,
          })),
          documents = mergeRanks<typeof pages[number] | typeof passages[number]>([pages, passages]);
        return [...rankedFaq.slice(0, 3), ...documents.slice(0, 6), ...rankedFaq.slice(3), ...documents.slice(6)];
      },
    },
  );
}
