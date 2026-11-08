import { localEnvironment } from './latency-local-env.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../packages/database/dist/index.js';

const label = process.argv[2] || 'after';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid report label');
const manifest = JSON.parse(await readFile('output/pdf/qadam-content.json', 'utf8'));
const db = createDatabase(localEnvironment().DATABASE_URL), sql = db.client;
try {
  const rows = await sql`SELECT a.id,a.created_at AS answer_created_at,a.decision,i.created_at AS received_at
    FROM answer_runs a JOIN telegram_inbox i ON i.id=a.id
    WHERE a.organization_id=${manifest.organizationId} AND a.event_id=${manifest.eventId}
      AND a.mode='live' AND a.created_at>='2026-11-07T22:00:00Z'
    ORDER BY a.created_at DESC LIMIT 12`;
  const samples = [];
  for (const row of rows) {
    const outgoing = await sql`SELECT status,available_at FROM telegram_outbox
      WHERE organization_id=${manifest.organizationId} AND event_id=${manifest.eventId}
      AND dedupe_key LIKE ${'answer/' + row.id + '/%'} ORDER BY created_at,id`;
    const acceptedAt = outgoing.length && outgoing.every(o => o.status === 'sent')
      ? Math.max(...outgoing.map(o => new Date(o.available_at).getTime())) : null;
    const duration = acceptedAt === null ? null : acceptedAt - new Date(row.received_at).getTime();
    const ids = ['understand','select','select-expanded','verify'].map(stage => createHash('sha256')
      .update(JSON.stringify([manifest.organizationId,manifest.eventId,row.id,stage])).digest('hex'));
    const operations = await sql`SELECT status,result->'diagnostics' AS diagnostics FROM ai_operations WHERE id IN ${sql(ids)}`;
    samples.push({ traceId: row.id, receivedAt: row.received_at, answerStoredAt: row.answer_created_at,
      telegramAcceptedAt: acceptedAt === null ? null : new Date(acceptedAt).toISOString(),
      webhookToTelegramAcceptedMs: duration,
      engineMs: row.decision.durationMs,
      overheadOutsideEngineMs: duration === null ? null : duration - row.decision.durationMs,
      outcome: row.decision.outcome, reason: row.decision.reasonCode, language: row.decision.language,
      answer: row.decision.answer, usage: row.decision.usage, steps: row.decision.steps, operations });
  }
  const report = { capturedAt: new Date().toISOString(), label,
    measurement: 'Server path from persisted Telegram webhook to successful sendMessage acknowledgement. Sent outbox available_at is assigned now() after Telegram success. Excludes Telegram-to-webhook transit and client display; overhead is not pure queue time.', samples };
  await writeFile(`output/latency/telegram-${label}-server.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(samples.map(({ traceId, webhookToTelegramAcceptedMs, engineMs, overheadOutsideEngineMs, reason }) =>
    ({ traceId, webhookToTelegramAcceptedMs, engineMs, overheadOutsideEngineMs, reason }))));
} finally { await db.close(); }
