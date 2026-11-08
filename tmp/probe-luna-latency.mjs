import { localEnvironment } from './latency-local-env.mjs';
import { writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { verifyFictionalCorpus } from './verify-fictional-corpus.mjs';
Object.assign(process.env, localEnvironment());
process.env.AI_REASONING_EFFORT = process.argv[2] ?? 'low';
process.env.AI_COMPACT_OUTPUT = '1';
const { createDatabase } = await import('../packages/database/dist/index.js');
const { runScopedAnswer } = await import('../apps/worker/dist/answers.js');
const db = createDatabase(process.env.DATABASE_URL), sql = db.client;
const keyUsage = async () => {
  const r = await fetch('https://api.wikivibe.dev/v1/usage', { headers: { Authorization: 'Bearer ' + process.env.AI_PLATFORM_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error('Usage unavailable');
  const b = await r.json(); return b.model_stats?.find(m => m.model === 'gpt-6-luna') ?? { requests: 0, actual_cost: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
};
try {
  await verifyFictionalCorpus();
  const [event] = await sql`SELECT id,organization_id FROM events WHERE id='4254f5fa-69c1-4127-93e5-b60817954da5'`;
  if (!event) throw Error('Missing benchmark event');
  const before = await keyUsage(), traceId = randomUUID(), start = performance.now();
  const decision = await runScopedAnswer(sql, { organizationId: event.organization_id, eventId: event.id, traceId,
    question: 'Каковы основания апелляции и до какого времени её можно подать?', language: 'ru', languageSelection: 'auto',
    mode: 'evaluation', activated: true, handoffEnabled: true, faqOnly: false, conversation: [] });
  const wallMs = Math.round(performance.now() - start);
  const ids = ['select','select-expanded','verify'].map(stage => createHash('sha256').update(JSON.stringify([event.organization_id,event.id,traceId,stage])).digest('hex'));
  const operations = await sql`SELECT status,cost_micros,result->'diagnostics' AS diagnostics FROM ai_operations WHERE id IN ${sql(ids)}`;
  const after = await keyUsage();
  const report = { model: 'gpt-6-luna', effort: process.env.AI_REASONING_EFFORT, wallMs, decision, operations,
    usageDelta: Object.fromEntries(['requests','actual_cost','input_tokens','output_tokens','cache_read_tokens'].map(k=>[k,(after[k]??0)-(before[k]??0)])) };
  await writeFile('output/pdf/luna-probe-'+process.env.AI_REASONING_EFFORT+'.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await db.close(); }
