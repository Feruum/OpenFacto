import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { searchDocuments } from '../dist/ingestion.js';
import { modelConfig } from '../dist/ingestion-vectors.js';

test('neighbor context stays on the same authorized version and page; revoked versions vanish', { timeout: 20_000 }, async () => {
  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
  const scope = { organizationId: randomUUID(), eventId: randomUUID() };
  const source = randomUUID(), version = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const previous = { embedding: process.env.EMBEDDING_URL, qdrant: process.env.QDRANT_URL, fetch: globalThis.fetch };
  delete process.env.EMBEDDING_URL;
  process.env.QDRANT_URL = 'http://127.0.0.1:59999';
  globalThis.fetch = async () => Response.json({ result: { points: [{ id: ids[1], score: 1 }, { id: randomUUID(), score: 1 }] } });
  try {
    await sql`insert into organizations(id,name) values(${scope.organizationId},'Context fixture')`;
    await sql`insert into events(id,organization_id,name) values(${scope.eventId},${scope.organizationId},'Fixture')`;
    await sql`insert into knowledge_sources(id,organization_id,event_id,kind,title,body)
      values(${source},${scope.organizationId},${scope.eventId},'document','Rules','')`;
    await sql`insert into source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility,ingestion_status,index_collections)
      values(${version},${scope.organizationId},${scope.eventId},${source},1,'Rules','','ru','{}','participant','ready',${sql.array([modelConfig().collection])}::text[])`;
    await sql`update knowledge_sources set published_version_id=${version} where id=${source}`;
    for (const [i, body] of ['Вход разрешён только с приглашением.', 'Приглашение должно быть письменным.', 'Другая страница.'].entries()) {
      await sql`insert into source_chunks(id,organization_id,event_id,source_id,version_id,ordinal,page,body)
        values(${ids[i]},${scope.organizationId},${scope.eventId},${source},${version},${i},${i === 2 ? 2 : 1},${body})`;
    }
    const hits = await searchDocuments(sql, scope, 'Какое приглашение?', 5);
    assert.deepEqual(new Set(hits.map(hit => hit.chunkId)), new Set(ids.slice(0, 2)));
    assert.ok(hits[0].text.includes('только с приглашением'));
    assert.ok(hits[0].text.includes('письменным'));
    assert.ok(!hits[0].text.includes('Другая страница'));
    assert.equal(hits[0].page, 1);
    // Exact lexical evidence must survive even when dense search misses it.
    globalThis.fetch = async () => Response.json({ result: { points: [] } });
    const lexical = await searchDocuments(sql, scope, 'письменным', 5);
    assert.ok(lexical.some(hit => hit.chunkId === ids[1] && hit.text.includes('письменным')));
    assert.ok(lexical.every(hit => hit.versionId === version && hit.page === 1));
    const appealId=randomUUID();
    await sql`insert into source_chunks(id,organization_id,event_id,source_id,version_id,ordinal,page,body)
      values(${appealId},${scope.organizationId},${scope.eventId},${source},${version},3,4,'Апелляция подаётся до 17:45.')`;
    const misspelled=await searchDocuments(sql,scope,'апеляция дедлайн',5);
    assert.ok(misspelled.some(hit=>hit.chunkId===appealId&&hit.page===4&&hit.text.includes('17:45')));
    await sql`update knowledge_sources set published_version_id=null where id=${source}`;
    assert.deepEqual(await searchDocuments(sql, scope, 'приглашение', 5), []);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.embedding === undefined) delete process.env.EMBEDDING_URL; else process.env.EMBEDDING_URL = previous.embedding;
    if (previous.qdrant === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = previous.qdrant;
    await sql`delete from organizations where id=${scope.organizationId}`;
    await sql.end();
  }
});
