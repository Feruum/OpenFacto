import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@openfacto/database';
import { runScopedAnswer } from '../dist/answers.js';

// Real language quality, deliberately separate from unit tests with controlled model responses.
test('live colloquial RU/KK, transliteration, fragments and follow-ups remain grounded', {
  skip: process.env.OPENFACTO_TEST_WIKIVIBE !== '1', timeout: 600000,
}, async () => {
  assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  const db = createDatabase(process.env.DATABASE_URL);
  const sql = db.client, org = randomUUID(), event = randomUUID(), source = randomUUID(), version = randomUUID();
  const title = 'Где проходит регистрация?', answer = 'Регистрация проходит с 09:00 до 10:00 в фойе главного зала.';
  const cases = [
    { question: 'чо где проходит рега ?', language: 'ru', expected: 'answer' },
    { question: 'рега кайда болады?', language: 'kk', expected: 'answer' },
    { question: 'tirkelu где?', language: 'ru', expected: 'answer' },
    { question: 'тіркелу кай жерде?', language: 'kk', expected: 'answer' },
    { question: 'регистрац где прох…', language: 'ru', expected: 'answer' },
    { question: 'рега?', language: 'ru', expected: 'clarify' },
    { question: 'а во ск?', language: 'ru', expected: 'time', conversation: [{question:'рега кайда?',answer}] },
    { question: 'мне можно без регистрации зайти?', language: 'ru', expected: 'no-answer' },
    { question: 'после 12 можно зарегаться как исключение?', language: 'ru', expected: 'no-answer' },
    { question: 'а во ск?', language: 'ru', expected: 'clarify' },
  ];
  try {
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Conversational quality fixture')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Demo','active')`;
    await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language)
      VALUES(${source},${org},${event},'faq',${title},${answer},'ru')`;
    await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility)
      VALUES(${version},${org},${event},${source},1,${title},${answer},'ru','{}','participant')`;
    await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
    const failures = [];
    for (const item of cases) {
      const decision = await runScopedAnswer(sql, { ...item, organizationId: org, eventId: event,
        traceId: randomUUID(), mode: 'evaluation', activated: true, faqOnly: false, handoffEnabled: true });
      console.log(JSON.stringify({ question: item.question, language: item.language, outcome: decision.outcome,
        reason: decision.reasonCode, answer: decision.answer, costMicros: decision.usage.costMicros }));
      const answered = ['approved_faq','grounded_answer'].includes(decision.outcome);
      const passes = item.expected === 'clarify' ? decision.outcome === 'clarify'
        : item.expected === 'no-answer' ? !answered && !['provider_unavailable','budget_exhausted','operation_uncertain'].includes(decision.reasonCode)
        : answered && decision.sources.some(s => s.versionId === version) &&
          (item.expected === 'time' ? /09:00/.test(decision.answer) : /фойе/iu.test(decision.answer));
      if (!passes) failures.push(item.question + ': ' + decision.reasonCode);
      if (['budget_exhausted','provider_unavailable','operation_uncertain'].includes(decision.reasonCode)) break;
    }
    assert.deepEqual(failures, [], 'Real language-quality failures');
  } finally {
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await db.close();
  }
});
