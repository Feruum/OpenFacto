import { createRequire } from 'node:module';
import { modelConfig } from '../apps/worker/dist/ingestion-vectors.js';
import { materializeFaq } from '../apps/worker/dist/ingestion-faq.js';
import { scheduleModelReindex } from '../apps/worker/dist/ingestion.js';

const require = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const postgres = require('postgres');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
const config = modelConfig();
if (!config.url) throw new Error('Configure semantic embeddings first');
const health = await fetch(new URL('/health', config.url), { signal: AbortSignal.timeout(5000) }).then(r => r.json());
if (health.model !== config.model || health.revision !== config.revision) throw new Error('Pinned model mismatch');
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
try {
  const faqs = await sql`SELECT v.organization_id,v.event_id,v.source_id,v.id FROM source_versions v
    JOIN knowledge_sources s ON (s.organization_id,s.event_id,s.id,s.published_version_id)=(v.organization_id,v.event_id,v.source_id,v.id)
    WHERE s.kind='faq' AND v.visibility='participant'`;
  const [pdfs] = await sql`SELECT count(*)::integer as count FROM source_versions v JOIN knowledge_sources s
    ON (s.organization_id,s.event_id,s.id,s.published_version_id)=(v.organization_id,v.event_id,v.source_id,v.id)
    WHERE v.original_sha256 IS NOT NULL AND v.ingestion_status='ready' AND v.visibility='participant'
      AND NOT (${config.collection}=any(v.index_collections))`;
  if (!process.argv.includes('--apply')) console.log(JSON.stringify({ publishedFaqs: faqs.length, pdfsNeedingReindex: pdfs.count, instruction: 'Restart the backend with the selected model, then use --apply. Old FAQ caches and vector collections are retained.' }));
  else {
    for (const row of faqs) await materializeFaq(sql, { organizationId: row.organization_id, eventId: row.event_id,
      documentId: row.source_id, versionId: row.id }, 'faq-title-alias-v1/' + config.collection);
    const queued = await scheduleModelReindex(sql);
    console.log(JSON.stringify({ preparedFaqs: faqs.length, queuedPdfs: queued.length, collection: config.collection }));
  }
} finally { await sql.end(); }
