import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { putOriginal, processIngestionJob, searchDocuments, sweepIngestion } from '../dist/ingestion.js';
import { readOriginal, objectKey } from '../dist/ingestion-storage.js';
import { candidates } from '../dist/ingestion-vectors.js';

function pdfFixture(mixed = false) {
  const stream = 'BT /F1 14 Tf 50 700 Td (Registration opens at nine in the main hall.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  if (mixed) {
    objects[1] = '<< /Type /Pages /Kids [3 0 R 6 0 R 9 0 R] /Count 3 >>';
    const draw = 'q 595 0 0 842 0 0 cm /Scan Do Q';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Scan 7 0 R >> >> /Contents 8 0 R >>',
      '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n80>\nendstream',
      `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    );
  }
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = text.length;
  text +=
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('');
  return Buffer.from(text + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test(
  'a private PDF becomes published evidence, stays in its event and is purged after revoke',
  { timeout: 120_000 },
  async () => {
    for (const key of ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'PDF_WORKER_TOKEN', 'QDRANT_URL'])
      assert.ok(process.env[key], key + ' is required');
    const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
    const scope = {
      organizationId: randomUUID(),
      eventId: randomUUID(),
      documentId: randomUUID(),
      versionId: randomUUID(),
    };
    const foreign = { ...scope, organizationId: randomUUID() };
    const revision = { ...scope, versionId: randomUUID() };
    const pdf = pdfFixture();
    const digest = createHash('sha256').update(pdf).digest('hex');
    try {
      await sql`insert into organizations(id,name) values(${scope.organizationId},'PDF integration')`;
      await sql`insert into events(id,organization_id,name) values(${scope.eventId},${scope.organizationId},'sample')`;
      await sql`insert into knowledge_sources(id,organization_id,event_id,kind,title,body) values(
      ${scope.documentId},${scope.organizationId},${scope.eventId},'document','Schedule','')`;
      await sql`insert into source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility,original_sha256,ingestion_status)
      values(${scope.versionId},${scope.organizationId},${scope.eventId},${scope.documentId},1,'Schedule','','en','{}','participant',${digest},'uploading')`;
      await putOriginal(scope, pdf);
      assert.deepEqual(await readOriginal(scope), pdf);
      const unsigned = await fetch(new URL(process.env.S3_BUCKET + '/' + objectKey(scope), process.env.S3_ENDPOINT));
      assert.equal(unsigned.status, 403);
      await unsigned.body?.cancel();
      await sql`update source_versions set ingestion_status='pending' where id=${scope.versionId}`;
      await processIngestionJob(sql, { name: 'ingest', data: foreign });
      const jobs = [];
      await sweepIngestion(sql, { add: async (name, data) => jobs.push({ name, data }) });
      const job = jobs.find((j) => j.data.versionId === scope.versionId);
      assert.ok(job);
      await processIngestionJob(sql, job);
      await processIngestionJob(sql, job);
      const [row] =
        await sql`select ingestion_status,ingestion_attempts from source_versions where id=${scope.versionId}`;
      assert.equal(row.ingestion_status, 'ready');
      assert.equal(row.ingestion_attempts, 1);
      const question = 'When does registration open?';
      assert.deepEqual(await searchDocuments(sql, scope, question), []);
      assert.equal((await searchDocuments(sql, scope, question, 3, 'draft_preview'))[0]?.page, 1);
      await sql`update knowledge_sources set published_version_id=${scope.versionId} where id=${scope.documentId}`;
      const hits = await searchDocuments(sql, scope, question);
      assert.equal(hits[0]?.versionId, scope.versionId);
      assert.match(hits[0].text, /main hall/);
      assert.deepEqual(await searchDocuments(sql, foreign, question), []);
      // Even the correct version ID cannot cross the organization filter inside Qdrant.
      assert.deepEqual(await candidates(foreign, [scope.versionId], question, 6), []);
      // A mixed-text replacement keeps the old publication and identifies every unusable page.
      const mixed = pdfFixture(true);
      const mixedHash = createHash('sha256').update(mixed).digest('hex');
      await sql`insert into source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility,original_sha256,ingestion_status)
        values(${revision.versionId},${scope.organizationId},${scope.eventId},${scope.documentId},2,'Revision','','en','{}','participant',${mixedHash},'pending')`;
      await putOriginal(revision, mixed);
      await assert.rejects(processIngestionJob(sql, { name: 'ingest', data: revision }), /Document ingestion failed/);
      const [rejected] =
        await sql`select ingestion_status,page_diagnostics from source_versions where id=${revision.versionId}`;
      assert.equal(rejected.ingestion_status, 'failed');
      assert.deepEqual(rejected.page_diagnostics, [
        { page: 2, status: 'needs_ocr' },
        { page: 3, status: 'needs_text' },
      ]);
      assert.equal((await sql`select id from source_chunks where version_id=${revision.versionId}`).length, 0);
      assert.deepEqual(await candidates(scope, [revision.versionId], question, 6), []);
      assert.equal((await searchDocuments(sql, scope, question))[0]?.versionId, scope.versionId);
      // Revoke after vector search but before SQL hydration. Previously retrieved IDs confer no access.
      const fetchBeforeRevoke = globalThis.fetch;
      try {
        globalThis.fetch = async (input, options) => {
          const response = await fetchBeforeRevoke(input, options);
          if (String(input).endsWith('/points/query')) {
            await sql`update knowledge_sources set published_version_id=null where id=${scope.documentId}`;
          }
          return response;
        };
        assert.deepEqual(await searchDocuments(sql, scope, question), []);
      } finally {
        globalThis.fetch = fetchBeforeRevoke;
      }
      await sql`delete from knowledge_sources where id=${scope.documentId}`;
      assert.deepEqual(await searchDocuments(sql, scope, question), []);
      await processIngestionJob(sql, { name: 'purge', data: foreign });
      assert.deepEqual(await readOriginal(scope), pdf);
      await processIngestionJob(sql, { name: 'purge', data: scope });
      await assert.rejects(readOriginal(scope), (error) => error.$metadata?.httpStatusCode === 404);
      assert.deepEqual(await candidates(scope, [scope.versionId], question, 6), []);
      assert.equal((await sql`select * from document_purges where version_id=${scope.versionId}`).length, 0);
    } finally {
      await sql`delete from organizations where id=${scope.organizationId}`;
      await Promise.all([scope, revision].map((data) => processIngestionJob(sql, { name: 'purge', data }))).finally(
        () => sql.end(),
      );
    }
  },
);
