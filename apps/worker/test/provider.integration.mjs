import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@openfacto/database';
import { runScopedAnswer } from '../dist/answers.js';

// Explicit opt-in, synthetic text only. Limit is in millionths of one USD.
test(
  'WikiVibe answers from a versioned source and reuses settled calls on replay',
  { skip: process.env.OPENFACTO_TEST_WIKIVIBE !== '1', timeout: 100000 },
  async () => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
    assert.equal(process.env.AI_CHAT_ENDPOINT, 'https://api.wikivibe.dev/v1/chat/completions');
    assert.ok(process.env.AI_PLATFORM_KEY);
    const db = createDatabase(process.env.DATABASE_URL);
    const sql = db.client;
    const org = randomUUID(),
      event = randomUUID(),
      source = randomUUID(),
      version = randomUUID();
    const text = 'The workshop starts at 13:30 on Tuesday.';
    try {
      await sql`INSERT INTO organizations(id,name) VALUES(${org},'WikiVibe isolated test')`;
      await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Demo','active')`;
      await sql`INSERT INTO event_ai_settings(organization_id,event_id,funding,daily_limit_micros) VALUES(${org},${event},'platform',10000)`;
      await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body) VALUES(${source},${org},${event},'document','Workshop guide',${text})`;
      await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility)
        VALUES(${version},${org},${event},${source},1,'Workshop guide',${text},'en','{}','participant')`;
      await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
      const input = {
        organizationId: org,
        eventId: event,
        question: 'When does the workshop start?',
        language: 'en',
        mode: 'published_preview',
        traceId: randomUUID(),
        activated: true,
        handoffEnabled: true,
        faqOnly: false,
      };
      const answer = await runScopedAnswer(sql, input);
      if (answer.outcome !== 'grounded_answer')
        console.log(
          'Provider diagnostics:',
          await sql`SELECT status,result->>'failure' AS failure,cost_micros FROM ai_operations WHERE organization_id=${org}`,
        );
      assert.equal(answer.outcome, 'grounded_answer', answer.reasonCode);
      assert.equal(answer.sources[0].versionId, version);
      assert.match(answer.answer, /13:30|1:30/);
      assert.equal(answer.usage.paidOperations, 3);
      const replay = await runScopedAnswer(sql, input);
      // Cached calls preserve evidence and charges, but have new measured timings.
      for (const decision of [answer,replay]) {
        assert.ok(decision.durationMs >= 0);
        assert.ok(decision.steps.every(step => step.durationMs === undefined || step.durationMs >= 0));
      }
      const withoutTiming = decision => ({ ...decision,durationMs:0,
        steps:decision.steps.map(step=>({...step,durationMs:0})) });
      assert.deepEqual(withoutTiming(replay), withoutTiming(answer));
      const [ledger] =
        await sql`SELECT count(*) AS count,sum(cost_micros) AS total FROM ai_operations WHERE organization_id=${org}`;
      assert.equal(Number(ledger.count), 3);
      assert.equal(Number(ledger.total), answer.usage.costMicros);
      console.log('WikiVibe verified:', process.env.AI_CHAT_MODEL, 'estimated micro-USD:', ledger.total);
    } finally {
      await sql`DELETE FROM organizations WHERE id=${org}`;
      await db.close();
    }
  },
);
