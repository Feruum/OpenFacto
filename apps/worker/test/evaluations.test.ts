import { expect, it, vi } from 'vitest';
import type { Decision, TraceStep } from '@openfacto/answer-engine';
import { evaluateCase, evaluationConfig } from '../src/evaluations.js';
import { runScopedAnswer } from '../src/answers.js';

vi.mock('../src/answers.js', () => ({ runScopedAnswer: vi.fn() }));
const ref = { sourceId: 'expected', versionId: 'v1', kind: 'faq' as const, title: 'Регистрация' };

async function evaluate(steps: TraceStep[], sourceId: string | undefined = 'expected') {
  let saved: Record<string, unknown> = {};
  let config: Record<string, unknown>;
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes("SET status='running'")) return [{ organization_id: 'org', event_id: 'event', config,
      results: [], cases: [{ question: 'Где рега?', language: 'ru', expectedOutcome: 'approved_faq', expectedSourceId: sourceId }], attempts: 1 }];
    if (text.includes('SET results=results')) { saved = JSON.parse(values[0] as string)[0]; return []; }
    if (text.includes('FROM memberships')) return [{}];
    if (text.includes('FROM events')) return [{ status: 'active', faq_only: false, handoff_enabled: true }];
    return [];
  };
  const sql = query as unknown as Parameters<typeof evaluateCase>[0];
  config = { ...await evaluationConfig(sql, 'org', 'event'), actor: 'editor' };
  vi.mocked(runScopedAnswer).mockResolvedValue({ outcome: 'approved_faq', reasonCode: 'exact_faq', sources: [ref],
    steps, usage: { costMicros: 0, paidOperations: 0 } } as Decision);
  await evaluateCase(sql, 'run');
  return saved;
}

it('records an exact FAQ hit as a successful source lookup', async () => {
  expect(await evaluate([{ stage: 'exact_faq', reason: 'matched', candidates: [ref] }]))
    .toMatchObject({ passed: true, sourcePassed: true, retrievalHit: true });
});
it('records the ranked source even when the exact lookup missed', async () => {
  expect((await evaluate([{ stage: 'exact_faq', reason: 'miss', candidates: [] },
    { stage: 'retrieval', reason: 'ranked', candidates: [ref] }])).retrievalHit).toBe(true);
});
it('distinguishes a completed search miss from a search that never ran', async () => {
  expect((await evaluate([{ stage: 'retrieval', reason: 'ranked', candidates: [] }])).retrievalHit).toBe(false);
  expect((await evaluate([{ stage: 'exact_faq', reason: 'miss', candidates: [] },
    { stage: 'understanding', reason: 'needs_clarification', candidates: [] }])).retrievalHit).toBeNull();
});
it('does not treat timing-only retrieval steps as completed searches', async () => {
  expect((await evaluate([{ stage: 'retrieval', reason: 'completed', candidates: [], durationMs: 10 }])).retrievalHit).toBeNull();
});
it('does not count a different exact FAQ as the expected source', async () => {
  expect((await evaluate([{ stage: 'exact_faq', reason: 'matched', candidates: [{ ...ref, sourceId: 'other' }] }])).retrievalHit).toBe(false);
});
it('leaves retrieval unscored when no expected source is supplied', async () => {
  expect((await evaluate([{ stage: 'exact_faq', reason: 'matched', candidates: [ref] }], '')).retrievalHit).toBeNull();
});
