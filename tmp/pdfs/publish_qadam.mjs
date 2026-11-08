import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import postgres from '../../apps/worker/node_modules/postgres/src/index.js';
import { putOriginal, readOriginal } from '../../apps/worker/dist/ingestion.js';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('output/pdf/qadam-content.json', root), 'utf8'));
const receiptFile = new URL('output/pdf/qadam-published.json', root);
const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice() {} });
const org = manifest.organizationId, event = manifest.eventId;
const scope = { organizationId: org, eventId: event };
try {
 if (process.argv[2] === 'stage') {
  let existing;
  try { existing = JSON.parse(await readFile(receiptFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) throw new Error('Staging receipt exists; inspect it before creating another revision');
  const [target] = await sql`SELECT e.id FROM events e JOIN telegram_bots b ON b.event_id=e.id AND b.organization_id=e.organization_id
   WHERE e.id=${event} AND e.organization_id=${org} AND b.username='openfactobot' AND b.allowed_chat_ids @> ARRAY['-1004396164391']::text[]`;
  if (!target) throw new Error('Requested event/bot/group mapping is missing');
  const documents = await Promise.all(manifest.documents.map(async d => {
   const bytes = await readFile(new URL('output/pdf/' + d.filename, root));
   return { ...d, bytes, hash: createHash('sha256').update(bytes).digest('hex') };
  }));
  const entries = await sql.begin(async tx => {
   const out = [];
   for (const item of [...manifest.faqs.map(f => ({ ...f, kind:'faq' })), ...documents.map(d => ({ ...d, kind:'document', body:'', language:'ru', aliases:[] }))]) {
    const id = item.existingId || randomUUID();
    if (item.existingId) {
     const [owned] = await tx`SELECT id FROM knowledge_sources WHERE id=${id} AND organization_id=${org} AND event_id=${event} AND kind='faq' FOR UPDATE`;
     if (!owned) throw new Error('Existing FAQ scope mismatch');
     await tx`UPDATE knowledge_sources SET title=${item.title},body=${item.body},language=${item.language},aliases=${tx.array(item.aliases)},updated_at=now() WHERE id=${id}`;
    } else {
     await tx`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language,aliases,visibility)
      VALUES(${id},${org},${event},${item.kind},${item.title},${item.body},${item.language},${tx.array(item.aliases)},'participant')`;
    }
    const versionId=randomUUID();
    await tx`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility,ingestion_status,original_sha256)
     SELECT ${versionId},${org},${event},${id},COALESCE(max(number),0)+1,${item.title},${item.body},${item.language},${tx.array(item.aliases)},'participant',${item.kind==='document'?'uploading':'none'},${item.hash??null}
     FROM source_versions WHERE source_id=${id} AND organization_id=${org} AND event_id=${event}`;
    out.push({sourceId:id,versionId,kind:item.kind,title:item.title,...(item.filename?{filename:item.filename,sha256:item.hash}:{})});
   }
   return out;
  });
  const receipt={organizationId:org,eventId:event,eventName:manifest.eventName,stage:'staged',entries};
  await writeFile(receiptFile,JSON.stringify(receipt,null,2));
  for (const entry of entries.filter(e=>e.kind==='document')) {
   const doc=documents.find(d=>d.filename===entry.filename);
   const s={...scope,documentId:entry.sourceId,versionId:entry.versionId};
   await putOriginal(s,doc.bytes);
   const stored=await readOriginal(s);
   if(createHash('sha256').update(stored).digest('hex')!==entry.sha256) throw new Error('S3 verification failed');
   await sql`UPDATE source_versions SET ingestion_status='pending',ingestion_available_at=now() WHERE id=${entry.versionId} AND ingestion_status='uploading'`;
  }
  console.log(JSON.stringify({staged:entries.length,pdfs:documents.length,faq:manifest.faqs.length}));
 } else if (process.argv[2] === 'publish') {
  const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
  await sql.begin(async tx=>{
   for(const entry of receipt.entries) {
    const [row]=await tx`SELECT id,ingestion_status FROM source_versions WHERE id=${entry.versionId} AND organization_id=${org} AND event_id=${event} AND source_id=${entry.sourceId} FOR SHARE`;
    if(!row || (entry.kind==='document'?row.ingestion_status!=='ready':row.ingestion_status!=='none')) throw new Error('A source is not ready: '+entry.title);
   }
   for(const entry of receipt.entries) await tx`UPDATE knowledge_sources SET published_version_id=${entry.versionId},updated_at=now() WHERE id=${entry.sourceId} AND organization_id=${org} AND event_id=${event}`;
   await tx`UPDATE events SET name=${manifest.eventName},faq_only=false,updated_at=now() WHERE id=${event} AND organization_id=${org}`;
  });
  receipt.stage='published';receipt.publishedAt=new Date().toISOString();
  await writeFile(receiptFile,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({published:receipt.entries.length,eventName:manifest.eventName}));
 } else {
  console.log(JSON.stringify(await sql`SELECT s.title,s.kind,v.ingestion_status,COUNT(c.id)::int AS chunks,
    s.published_version_id=v.id AS published FROM knowledge_sources s JOIN source_versions v ON v.source_id=s.id AND v.number=(SELECT max(v2.number) FROM source_versions v2 WHERE v2.source_id=s.id)
    LEFT JOIN source_chunks c ON c.version_id=v.id WHERE s.organization_id=${org} AND s.event_id=${event}
    GROUP BY s.id,v.id ORDER BY s.kind,s.title`));
 }
} finally {await sql.end();}
