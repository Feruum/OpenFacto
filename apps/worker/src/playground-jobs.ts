import type postgres from 'postgres';
import type { AnswerInput, Decision } from '@openfacto/answer-engine';
import { loadEvidence, type Query, type Transaction } from '@openfacto/database';
import { liveReferencesCurrent, runScopedAnswer } from './answers.js';

/** Traces can reveal source titles too, so validate every referenced candidate. */
export async function playgroundReferencesCurrent(tx: Query, org: string, event: string, mode: string, decision: Decision) {
  const refs = [...decision.sources, ...decision.steps.flatMap(step => step.candidates)];
  if (!refs.length) return true;
  const ids = [...new Set(refs.map(ref => ref.sourceId))];
  const locked = await tx`SELECT id FROM knowledge_sources WHERE organization_id=${org} AND event_id=${event}
    AND id IN ${tx(ids)} ORDER BY id FOR SHARE`;
  if (locked.length !== ids.length) return false;
  if (mode === 'published_preview') return liveReferencesCurrent(tx, org, event, refs);
  const sources = await loadEvidence(tx, org, event, true, undefined, ids);
  return refs.every(ref => sources.some(source => source.sourceId === ref.sourceId && source.versionId === ref.versionId));
}

async function allowed(tx: Transaction, row: {organization_id:string;event_id:string;actor_id:string}) {
  const [event] = await tx`SELECT e.id FROM events e JOIN memberships m ON m.organization_id=e.organization_id
    WHERE e.organization_id=${row.organization_id} AND e.id=${row.event_id} AND e.status<>'archived'
      AND m.user_id=${row.actor_id} AND m.role IN ('owner','admin','editor','moderator') FOR SHARE OF e,m`;
  return !!event;
}

/** SQL lease fences duplicate RabbitMQ messages; the trace is stable across retries. */
export async function processPlaygroundJob(sql: postgres.Sql, id: string) {
  const [row] = await sql`UPDATE playground_requests SET status='running',attempts=attempts+1,
    available_at=now()+interval '5 minutes',error_code=null
    WHERE id=${id} AND status IN ('pending','running') AND available_at<=now() AND attempts<3 AND input IS NOT NULL
    RETURNING *,now() AS claimed_at`;
  if (!row) return;
  const workerStarted = performance.now();
  const scope = { organization_id:String(row.organization_id),event_id:String(row.event_id),actor_id:String(row.actor_id) };
  async function fail(code: string) {
    await sql`UPDATE playground_requests SET status='failed',error_code=${code},input=null
      WHERE id=${id} AND status='running' AND attempts=${row!.attempts}`;
  }
  try {
    if (!(await sql.begin(tx => allowed(tx, scope)))) return await fail('access_changed');
    const input = row.input as Omit<AnswerInput, 'sources'>;
    const answer = await runScopedAnswer(sql, { ...input,
      organizationId: row.organization_id, eventId: row.event_id, traceId: row.trace_id });
    const result: Decision = { ...answer, delivery: {
      requestId: id,
      queuedAt: new Date(row.created_at).toISOString(),
      startedAt: new Date(row.claimed_at).toISOString(),
      answerReadyAt: new Date().toISOString(),
      queueWaitMs: Math.max(0, new Date(row.claimed_at).getTime() - new Date(row.created_at).getTime()),
      workerDurationMs: Math.round(performance.now() - workerStarted),
    } };
    await sql.begin(async tx => {
      const [claim] = await tx`SELECT id FROM playground_requests WHERE id=${id}
        AND status='running' AND attempts=${row.attempts} FOR UPDATE`;
      if (!claim) return;
      if (!(await allowed(tx, scope)) || !(await playgroundReferencesCurrent(tx, row.organization_id, row.event_id, row.mode, result))) {
        await tx`UPDATE playground_requests SET status='failed',error_code='access_changed',input=null WHERE id=${id}`;
        return;
      }
      await tx`INSERT INTO answer_runs(id,organization_id,event_id,mode,outcome,decision)
        VALUES(${row.trace_id},${row.organization_id},${row.event_id},${row.mode},${result.outcome},${tx.json(JSON.parse(JSON.stringify(result)))})`;
      await tx`UPDATE playground_requests SET status='completed',input=null,error_code=null WHERE id=${id}`;
    });
  } catch {
    await sql`UPDATE playground_requests SET status=${row.attempts >= 3 ? 'failed' : 'pending'},
      error_code='job_failed',available_at=now()+interval '10 seconds',
      input=CASE WHEN attempts>=3 THEN null ELSE input END
      WHERE id=${id} AND status='running' AND attempts=${row.attempts}`;
  }
}
