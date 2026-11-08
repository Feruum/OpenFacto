import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localEnvironment } from './latency-local-env.mjs';
import postgres from '../apps/worker/node_modules/postgres/src/index.js';
export async function verifyFictionalCorpus() {
  const manifest = JSON.parse(await readFile('output/pdf/qadam-content.json','utf8'));
  if (manifest.fictional !== true) throw Error('Dataset not marked fictional');
  const docs = await Promise.all(manifest.documents.map(async doc => ({ ...doc,
    sha256: createHash('sha256').update(await readFile('output/pdf/'+doc.filename)).digest('hex') })));
  const sql = postgres(localEnvironment().DATABASE_URL);
  try {
    const rows = await sql`SELECT s.id,s.kind,v.title,v.body,v.original_sha256 FROM knowledge_sources s JOIN source_versions v ON v.id=s.published_version_id
      WHERE s.organization_id=${manifest.organizationId} AND s.event_id=${manifest.eventId} AND v.visibility='participant'`;
    const unverified = rows.filter(row => row.kind === 'faq'
      ? !manifest.faqs.some(f => f.title === row.title && f.body === row.body)
      : !docs.some(d => d.title === row.title && d.sha256 === row.original_sha256));
    if (unverified.length || rows.length !== manifest.faqs.length+docs.length) throw Error('Published corpus differs from reviewed synthetic files: '+unverified.map(r=>r.title).join(', '));
    return { fictional: true, publishedSources: rows.length, faq: manifest.faqs.length, pdf: docs.length, matched: true };
  } finally { await sql.end(); }
}
if (process.argv[1]?.endsWith('verify-fictional-corpus.mjs')) console.log(JSON.stringify(await verifyFictionalCorpus()));
