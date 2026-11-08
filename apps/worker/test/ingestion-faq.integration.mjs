import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { loadEvidence } from '@openfacto/database';
import { processIngestionJob, rankScopedFaqCandidates, sweepIngestion } from '../dist/ingestion.js';
import { runScopedAnswer } from '../dist/answers.js';

test(
  'FAQ publication prepares model-specific vectors; all current versions are searchable with one query embedding',
  { timeout: 90_000 },
  async () => {
    assert.ok(process.env.DATABASE_URL);
    const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
    const scope = { organizationId: randomUUID(), eventId: randomUUID() };
    const env = {
      EMBEDDING_URL: 'http://127.0.0.1:58082/v1/embeddings',
      EMBEDDING_MODEL: 'faq-fixture',
      EMBEDDING_REVISION: 'v1',
      EMBEDDING_DIMENSIONS: '8',
      RABBITMQ_URL: 'amqp://127.0.0.1:1',
      QDRANT_URL: 'http://127.0.0.1:1',
    };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    const originalFetch = globalThis.fetch;
    const requests = [];
    const ids = Array.from({ length: 55 }, () => randomUUID()).sort();
    const fixtures = ids.map((id, i) => ({
      id,
      vid: randomUUID(),
      title: i === 54 ? 'Shuttle terminal' : 'Inventory record ' + i,
    }));
    const target = fixtures.at(-1);
    const question = 'Where does the bus depart?';
    try {
      Object.assign(process.env, env);
      globalThis.fetch = async (url, opts) => {
        assert.equal(String(url), env.EMBEDDING_URL);
        const request = JSON.parse(opts.body);
        requests.push(request.input);
        return Response.json({
          model: env.EMBEDDING_MODEL,
          data: request.input.map((text, index) => ({
            index,
            embedding: text === target.title || text === question ? [1, 0, 0, 0, 0, 0, 0, 0] : [0, 1, 0, 0, 0, 0, 0, 0],
          })),
        });
      };
      await sql.begin(async (tx) => {
        await tx`insert into organizations(id,name) values(${scope.organizationId},'FAQ embedding test')`;
        await tx`insert into events(id,organization_id,name) values(${scope.eventId},${scope.organizationId},'FAQ test')`;
        const rows = fixtures.map((f) => ({
          id: f.id,
          organization_id: scope.organizationId,
          event_id: scope.eventId,
          kind: 'faq',
          title: f.title,
          body: 'Verified approved answer',
          language: 'en',
        }));
        await tx`insert into knowledge_sources ${tx(rows)}`;
        await tx`insert into source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility)
        select unnest(${tx.array(fixtures.map((f) => f.vid))}::uuid[]),${scope.organizationId},${scope.eventId},unnest(${tx.array(ids)}::uuid[]),1,
          unnest(${tx.array(fixtures.map((f) => f.title))}::text[]),'Verified approved answer','en','{}','participant'`;
        await tx`update knowledge_sources s set published_version_id=v.id from source_versions v
        where (s.organization_id,s.event_id,s.id)=(v.organization_id,v.event_id,v.source_id) and s.organization_id=${scope.organizationId}`;
      });
      async function work() {
        const jobs = [];
        await sweepIngestion(sql, {
          add: async (name, data) => {
            if (name === 'embed-faq' && data.organizationId === scope.organizationId) jobs.push({ name, data });
          },
        });
        return jobs;
      }
      for (let round = 0; round < 3; round++) {
        const due = await work();
        assert.ok(due.length <= 32);
        for (const job of due) {
          await Promise.all([processIngestionJob(sql, job), processIngestionJob(sql, job)]);
        }
      }
      assert.equal((await work()).length, 0);
      assert.equal(requests.length, 55);
      const authorized = await loadEvidence(sql, scope.organizationId, scope.eventId, false, 'faq');
      const ranked = await rankScopedFaqCandidates(sql, scope, question, authorized, 3);
      assert.equal(ranked[0]?.source.versionId, target.vid);
      assert.ok(ranked[0].score > 0.69);
      await rankScopedFaqCandidates(sql, scope, question, authorized, 3);
      assert.deepEqual(requests.slice(55), [[question], [question]]);
      assert.deepEqual(
        await rankScopedFaqCandidates(sql, { ...scope, organizationId: randomUUID() }, question, authorized),
        [],
      );
      // A different model revision cannot reuse old coordinates, even if dimensions agree.
      process.env.EMBEDDING_REVISION = 'v2';
      const uncached = await rankScopedFaqCandidates(sql, scope, question, authorized, 3);
      assert.ok(uncached.every((h) => h.score === 0));
      const next = await work();
      // The global sweep may also include published FAQs from other local fixtures.
      assert.ok(next.length > 0 && next.length <= 32);
      const retry = next[0];
      const fixtureFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error('Local model warming'); };
      await assert.rejects(processIngestionJob(sql, retry), /embedding deferred/);
      const [deferred] = await sql`select attempts, embedding, available_at>now() as delayed from faq_embeddings
        where version_id=${retry.data.versionId} and model_key=${retry.data.modelKey}`;
      assert.deepEqual({...deferred}, {attempts:1,embedding:null,delayed:true});
      await sql`update faq_embeddings set available_at=now() where version_id=${retry.data.versionId} and model_key=${retry.data.modelKey}`;
      globalThis.fetch = fixtureFetch;
      await processIngestionJob(sql,retry);
      const [recovered] = await sql`select attempts,cardinality(embedding) as dims from faq_embeddings
        where version_id=${retry.data.versionId} and model_key=${retry.data.modelKey}`;
      assert.deepEqual({...recovered}, {attempts:2,dims:8});
      process.env.EMBEDDING_REVISION = 'v1';
      // A stale caller list cannot keep an unpublished FAQ alive.
      await sql`update knowledge_sources set published_version_id=null where id=${target.id}`;
      assert.ok(
        !(await rankScopedFaqCandidates(sql, scope, question, authorized, 32)).some(
          (h) => h.source.versionId === target.vid,
        ),
      );
      // Exact FAQ matches bypass Qdrant, local inference, and the paid model.
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        throw new Error('Offline');
      };
      const exact = await runScopedAnswer(sql, {
        ...scope,
        traceId: randomUUID(),
        question: fixtures[0].title,
        language: 'en',
        mode: 'live',
        activated: true,
        handoffEnabled: true,
        faqOnly: true,
      });
      assert.equal(exact.outcome, 'approved_faq');
      assert.equal(exact.usage.paidOperations, 0);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await sql`delete from organizations where id=${scope.organizationId}`;
      assert.equal(
        (await sql`select version_id from faq_embeddings where organization_id=${scope.organizationId}`).length,
        0,
      );
      await sql.end();
    }
  },
);
