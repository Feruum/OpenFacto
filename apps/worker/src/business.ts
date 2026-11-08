import {
  AI_QUESTIONS_QUEUE, DOCUMENTS_QUEUE, EVALUATIONS_QUEUE, DELIVERY_QUEUE,
  type RabbitTransport, type Job, type QueueName,
} from '@openfacto/queue';
import { createDatabase } from '@openfacto/database';
import type postgres from 'postgres';
import { processUpdate, deliver } from './telegram.js';
import { processPlaygroundJob } from './playground-jobs.js';
import { evaluateCase } from './evaluations.js';
import { processIngestionJob, sweepIngestion } from './ingestion.js';
import { modelConfig } from './ingestion-vectors.js';
import { createBusinessSweepScheduler, requestBusinessWake } from './business-wake.js';

/** Scope is loaded from SQL; broker notifications carry only the immutable version ID. */
async function processDocument(sql: postgres.Sql, job: Job) {
  const [row] = job.name === 'purge'
    ? await sql`SELECT organization_id,event_id,source_id,version_id FROM document_purges WHERE version_id=${job.data.id}`
    : await sql`SELECT organization_id,event_id,source_id,id AS version_id FROM source_versions WHERE id=${job.data.id}`;
  if (!row) return;
  await processIngestionJob(sql, { name: job.name, data: {
    organizationId: row.organization_id, eventId: row.event_id,
    documentId: row.source_id, versionId: row.version_id,
    ...(job.name === 'embed-faq' ? { modelKey: 'faq-title-alias-v1/' + modelConfig().collection } : {}),
  } });
}

/** PostgreSQL is the work ledger. Recovery republishes due IDs after loss or restarts. */
export function businessWorkers(transport: RabbitTransport, databaseUrl: string, concurrency: number, report: () => void) {
  const database = createDatabase(databaseUrl, 10000);
  const sql = database.client;
  const consume = (queue: QueueName, handler: (job: Job) => Promise<unknown>, limit: number) => {
    transport.consume(queue, async job => {
      let completed = false;
      try { await handler(job); completed = true; }
      finally {
        await sql`DELETE FROM queue_dispatches WHERE queue=${queue} AND name=${job.name} AND job_id=${job.data.id}`;
        // A failed handler may not have persisted a claim/backoff. Let the
        // recovery timer retry it instead of creating a self-triggered loop.
        if (completed) requestBusinessWake();
      }
    }, { concurrency: limit });
  };
  consume(AI_QUESTIONS_QUEUE, job => job.name === 'telegram'
    ? processUpdate(sql, job.data.id) : processPlaygroundJob(sql, job.data.id), concurrency);
  consume(DELIVERY_QUEUE, job => deliver(sql, job.data.id), concurrency);
  consume(DOCUMENTS_QUEUE, job => processDocument(sql, job), 1);
  consume(EVALUATIONS_QUEUE, job => evaluateCase(sql, job.data.id), 1);
  async function publish(queue: QueueName, job: Job) {
    const [lease] = await sql`INSERT INTO queue_dispatches(queue,name,job_id,available_at)
      VALUES(${queue},${job.name},${job.data.id},now()+interval '5 minutes')
      ON CONFLICT(queue,name,job_id) DO UPDATE SET available_at=excluded.available_at
        WHERE queue_dispatches.available_at<=now() RETURNING available_at::text AS lease`;
    if (!lease) return;
    try { await transport.publish(queue, job); }
    catch (error) {
      await sql`DELETE FROM queue_dispatches WHERE queue=${queue} AND name=${job.name} AND job_id=${job.data.id}
        AND available_at::text=${lease.lease}`;
      throw error;
    }
  }
  let nextMaintenanceAt = 0;
  let stopped = false;
  async function sweep() {
    await sql`UPDATE telegram_outbox SET status='uncertain' WHERE status='sending' AND available_at<now()`;
    await sql`UPDATE telegram_outbox o SET status='failed' FROM telegram_outbox previous WHERE
      o.predecessor_id=previous.id AND o.status='pending' AND previous.status IN ('uncertain','failed')`;
    await sql`UPDATE telegram_inbox SET status='failed' WHERE status='pending' AND attempts>=5 AND available_at<=now()`;
    await sql`UPDATE playground_requests SET status='failed',error_code='attempts_exhausted'
      WHERE status IN ('pending','running') AND attempts>=3 AND available_at<=now()`;
    const questions = await sql`
      (SELECT id,'telegram' AS kind FROM telegram_inbox
        WHERE status='pending' AND attempts<5 AND available_at<=now()
        AND NOT EXISTS(SELECT 1 FROM queue_dispatches d WHERE d.queue='ai.questions' AND d.name='telegram'
          AND d.job_id=telegram_inbox.id AND d.available_at>now()) ORDER BY created_at LIMIT 50)
      UNION ALL (SELECT id,'playground' AS kind FROM playground_requests
        WHERE status IN ('pending','running') AND attempts<3 AND available_at<=now()
        AND NOT EXISTS(SELECT 1 FROM queue_dispatches d WHERE d.queue='ai.questions' AND d.name='playground'
          AND d.job_id=playground_requests.id AND d.available_at>now()) ORDER BY created_at LIMIT 50)`;
    for (const row of questions) {
      if (stopped) return;
      await publish(AI_QUESTIONS_QUEUE, { name: row.kind, data: { id: row.id } });
    }
    const outgoing = await sql`SELECT o.id FROM telegram_outbox o LEFT JOIN telegram_outbox prev ON prev.id=o.predecessor_id
      WHERE o.status='pending' AND o.available_at<=now() AND (o.predecessor_id IS NULL OR prev.status='sent')
      AND NOT EXISTS(SELECT 1 FROM queue_dispatches d WHERE d.queue='messages.delivery' AND d.name='outgoing'
        AND d.job_id=o.id AND d.available_at>now())
      ORDER BY o.created_at LIMIT 50`;
    for (const row of outgoing) {
      if (stopped) return;
      await publish(DELIVERY_QUEUE, { name: 'outgoing', data: { id: row.id } });
    }
    // Wake bursts accelerate question/outbox delivery, not maintenance scans.
    if (Date.now() >= nextMaintenanceAt) {
      nextMaintenanceAt = Date.now() + 10000;
      await sql`UPDATE evaluation_runs SET status='failed' WHERE status IN ('pending','running') AND attempts>=3 AND available_at<=now()`;
      const runs = await sql`SELECT id FROM evaluation_runs WHERE status IN ('pending','running') AND attempts<3
        AND available_at<=now() AND NOT EXISTS(SELECT 1 FROM queue_dispatches d
          WHERE d.queue='ai.evaluations' AND d.name='case' AND d.job_id=evaluation_runs.id AND d.available_at>now())
        ORDER BY created_at LIMIT 20`;
      for (const row of runs) {
        if (stopped) return;
        await publish(EVALUATIONS_QUEUE, { name: 'case', data: { id: row.id } });
      }
      await sql`DELETE FROM clarification_context WHERE expires_at<now()`;
      await sql`DELETE FROM telegram_chat_usage WHERE day<(now() AT TIME ZONE 'UTC')::date`;
      await sql`DELETE FROM queue_dispatches WHERE available_at<now()-interval '1 day'`;
      await sweepIngestion(sql, { add: async (name, data) => {
        if (!stopped) await publish(DOCUMENTS_QUEUE, { name, data: { id: data.versionId } });
      } });
    }
  }
  const scheduler = createBusinessSweepScheduler(sweep, report);
  const stopSweeps = () => { stopped = true; scheduler.stop(); };
  let closing: Promise<void> | undefined;
  return {
    start() { scheduler.start(); },
    stopSweeps,
    close() {
      return closing ??= (async () => {
        stopSweeps();
        await scheduler.close();
        await database.close();
      })();
    },
  };
}
