import { BadRequestException } from '@nestjs/common';
import type { Transaction } from '@openfacto/database';
import { first, type Scope } from './input.js';

export function reportDays(raw: unknown) {
  if (raw === undefined) return 30;
  if (typeof raw !== 'string' || !/^[1-9]\d?$/.test(raw) || Number(raw) > 90) throw new BadRequestException();
  return Number(raw);
}

/** Aggregate only fixed outcome/reason labels; participant text never leaves SQL. */
export async function report(tx: Transaction, s: Scope, days: number) {
  return first(
    await tx`
    WITH bounds AS (
      SELECT date_trunc('day',now()) - (${days}::integer-1)*interval '1 day' AS since
    ), runs AS MATERIALIZED (
      SELECT mode,
        CASE WHEN outcome IN ('ignored','approved_faq','grounded_answer','clarify','handoff','refuse') THEN outcome ELSE 'other' END AS outcome,
        CASE WHEN decision->>'reasonCode' IN ('not_activated','empty_question','source_changed','exact_faq','semantic_faq','conflicting_sources',
          'provider_unavailable','insufficient_evidence','unsupported_claim','document_evidence','ambiguous_question','personal_decision',
          'off_topic','budget_exhausted','operation_uncertain','chat_rate_limited','rate_limited')
          THEN decision->>'reasonCode' ELSE 'other' END AS reason,
        CASE WHEN jsonb_typeof(decision->'durationMs')='number' THEN (decision->>'durationMs')::float8 END AS ms
      FROM answer_runs,bounds WHERE organization_id=${s.org} AND event_id=${s.event}
        AND created_at BETWEEN bounds.since AND now() AND mode IN ('live','published_preview','draft_preview')
    ), modes(mode) AS (VALUES ('live'),('published_preview'),('draft_preview')),
    ledger AS (
      SELECT funding,status,cost_micros,reserved_micros FROM ai_operations,bounds
      WHERE organization_id=${s.org} AND event_id=${s.event} AND day BETWEEN bounds.since::date AND current_date
    )
    SELECT ${days}::int AS days,bounds.since AS "periodStart",
      (SELECT count(*)::int FROM runs WHERE mode='live' AND outcome<>'ignored') AS questions,
      (SELECT count(*)::int FROM runs WHERE mode='live' AND outcome IN ('approved_faq','grounded_answer')) AS answered,
      (SELECT count(*)::int FROM handoffs WHERE organization_id=${s.org} AND event_id=${s.event} AND created_at BETWEEN bounds.since AND now()) AS handoffs,
      (SELECT count(*)::int FROM handoffs WHERE organization_id=${s.org} AND event_id=${s.event} AND status='open') AS "openHandoffs",
      (SELECT count(*)::int FROM knowledge_sources WHERE organization_id=${s.org} AND event_id=${s.event}) AS sources,
      (SELECT count(*)::int FROM knowledge_sources WHERE organization_id=${s.org} AND event_id=${s.event} AND published_version_id IS NOT NULL) AS "publishedSources",
      (SELECT jsonb_agg(jsonb_build_object('mode',m.mode,'runs',t.runs,'latencyMs',jsonb_build_object('p50',t.p50,'p95',t.p95),
        'outcomes', COALESCE((SELECT jsonb_object_agg(outcome,n) FROM (SELECT outcome,count(*) AS n FROM runs WHERE mode=m.mode GROUP BY outcome) o),'{}'),
        'reasons', COALESCE((SELECT jsonb_object_agg(reason,n) FROM (SELECT reason,count(*) AS n FROM runs WHERE mode=m.mode GROUP BY reason) r),'{}')
      ) ORDER BY m.mode) FROM modes m CROSS JOIN LATERAL (
        SELECT count(*)::int AS runs,
          percentile_cont(0.50) WITHIN GROUP(ORDER BY ms) FILTER(WHERE outcome<>'ignored' AND ms>=0) AS p50,
          percentile_cont(0.95) WITHIN GROUP(ORDER BY ms) FILTER(WHERE outcome<>'ignored' AND ms>=0) AS p95
        FROM runs WHERE mode=m.mode
      ) t) AS "byMode",
      (SELECT jsonb_build_object(
        'settledOperations',count(*) FILTER(WHERE status='settled'),'settledCostMicros',COALESCE(sum(cost_micros) FILTER(WHERE status='settled'),0),
        'reservedOperations',count(*) FILTER(WHERE status='reserved'),'reservedMicros',COALESCE(sum(reserved_micros) FILTER(WHERE status='reserved'),0),
        'uncertainOperations',count(*) FILTER(WHERE status='uncertain'),'uncertainMicros',COALESCE(sum(reserved_micros) FILTER(WHERE status='uncertain'),0),
        'platformCostMicros',COALESCE(sum(cost_micros) FILTER(WHERE status='settled' AND funding='platform'),0),
        'byokCostMicros',COALESCE(sum(cost_micros) FILTER(WHERE status='settled' AND funding='byok'),0)
      ) FROM ledger) AS usage
    FROM bounds`,
  );
}
