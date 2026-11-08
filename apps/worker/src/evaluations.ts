import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Language, Outcome } from '@openfacto/answer-engine';
import type { Query } from '@openfacto/database';
import { runScopedAnswer } from './answers.js';

export interface EvaluationCase {
  question: string;
  language: Language;
  expectedOutcome: Outcome;
  expectedSourceId?: string;
}
export async function evaluationConfig(sql: Query, org: string, event: string) {
  const publications = await sql`SELECT id,published_version_id FROM knowledge_sources WHERE organization_id=${org}
    AND event_id=${event} AND published_version_id IS NOT NULL ORDER BY id`;
  const [settings] =
    await sql`SELECT faq_only,handoff_enabled,status FROM events WHERE organization_id=${org} AND id=${event}`;
  const [ai] =
    await sql`SELECT funding,daily_limit_micros FROM event_ai_settings WHERE organization_id=${org} AND event_id=${event}`;
  return {
    policy: 'conversational-evidence-v3',
    model: process.env.AI_CHAT_MODEL ?? null,
    configurationHash: createHash('sha256')
      .update(
        JSON.stringify([
          process.env.AI_CHAT_ENDPOINT,
          process.env.AI_INPUT_MICROS_PER_1K,
          process.env.AI_OUTPUT_MICROS_PER_1K,
          process.env.AI_PLATFORM_DAILY_MICROS,
          ai?.funding ?? 'platform',
          ai?.daily_limit_micros,
          process.env.EMBEDDING_DIMENSIONS,
          process.env.RERANK_URL,
        ]),
      )
      .digest('hex'),
    embedding: process.env.EMBEDDING_MODEL ?? 'character-ngram',
    revision: process.env.EMBEDDING_REVISION ?? null,
    corpusHash: createHash('sha256').update(JSON.stringify(publications)).digest('hex'),
    faqOnly: settings?.faq_only,
    handoffEnabled: settings?.handoff_enabled,
    status: settings?.status,
  };
}
// One case per claim keeps short runs responsive and resumes at the first unfinished case.
export async function evaluateCase(sql: postgres.Sql, id: string) {
  const [run] =
    await sql`UPDATE evaluation_runs SET status='running',available_at=now()+interval '3 minutes',attempts=attempts+1
    WHERE id=${id} AND status IN ('pending','running') AND available_at<=now() RETURNING *`;
  if (!run) return;
  async function authorized() {
    const [member] = await sql`SELECT 1 FROM memberships WHERE organization_id=${run!.organization_id}
      AND user_id=${run!.config.actor} AND role IN ('owner','admin','editor')`;
    const current = await evaluationConfig(sql, run!.organization_id, run!.event_id);
    return (
      !!member && current.status !== 'archived' && Object.entries(current).every(([k, v]) => run!.config[k] === v)
    );
  }
  async function failed() {
    await sql`UPDATE evaluation_runs SET status='failed' WHERE id=${id} AND attempts=${run!.attempts} AND status='running'`;
  }
  const index = run.results.length;
  const item = (run.cases as EvaluationCase[])[index];
  if (!item || !(await authorized())) {
    await failed();
    return;
  }
  const started = performance.now();
  const decision = await runScopedAnswer(sql, {
    organizationId: run.organization_id,
    eventId: run.event_id,
    traceId: id + '/' + index,
    activated: true,
    mode: 'evaluation',
    faqOnly: run.config.faqOnly,
    handoffEnabled: run.config.handoffEnabled,
    language: item.language,
    question: item.question,
  });
  if (!(await authorized())) {
    await failed();
    return;
  }
  // Exact FAQ answers bypass ranked retrieval. Clarification/provider failure before
  // either lookup completes is unscored, rather than a false search miss.
  const lookups = decision.steps.filter(step =>
    step.stage === 'exact_faq' && step.reason === 'matched' ||
    step.stage === 'retrieval' && step.reason === 'ranked');
  const result = {
    index,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    sources: decision.sources,
    passed:
      decision.outcome === item.expectedOutcome &&
      (!item.expectedSourceId || decision.sources.some((s) => s.sourceId === item.expectedSourceId)),
    costMicros: decision.usage.costMicros,
    stages: decision.steps.filter(step => step.durationMs !== undefined),
    retrievalHit: !item.expectedSourceId || !lookups.length ? null :
      lookups.some(step => step.candidates.some(source => source.sourceId === item.expectedSourceId)),
    outcomePassed: decision.outcome === item.expectedOutcome,
    sourcePassed: !item.expectedSourceId || decision.sources.some(source => source.sourceId === item.expectedSourceId),
    durationMs: Math.round(performance.now() - started),
  };
  await sql`UPDATE evaluation_runs SET results=results || ${JSON.stringify([result])}::text::jsonb,
    status=${index + 1 === run.cases.length ? 'completed' : 'pending'},attempts=0,available_at=now()
    WHERE id=${id} AND status='running' AND attempts=${run.attempts} AND jsonb_array_length(results)=${index}`;
}
