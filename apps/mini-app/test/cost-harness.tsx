import { createRoot } from 'react-dom/client'
import { Playground } from '../src/Testing'
import { localize } from '../src/i18n'
import type { Decision } from '@openfacto/answer-engine'
import type { EvaluationRun, EventClient } from '../src/workspace'

export function mount() {
  document.getElementById('root')!.style.display = 'none'
  const element = document.createElement('div')
  document.body.append(element)
  const costs = [null, 0, 1250]
  const evaluation = {
    id: 'cost-fixture', status: 'completed', createdAt: '2026-01-01T00:00:00Z',
    cases: costs.map((_, index) => ({ question: `Cost case ${index}`, language: 'en', expectedOutcome: 'approved_faq' })),
    results: costs.map((costMicros, index) => ({ index, outcome: 'approved_faq', reasonCode: 'semantic_faq',
      passed: true, costMicros, durationMs: 10, sources: [] })),
  } as EvaluationRun
  let next = 0
  const client = {
    evaluations: async () => [evaluation],
    evaluation: async () => evaluation,
    playground: async () => ({
      outcome: 'approved_faq', answer: `Answer ${next}`, sources: [],
      steps: [...costs, undefined].map((costMicros, index) => ({ stage: 'selection', reason: `step-${index}`,
        candidates: [], durationMs: 10, ...(costMicros === undefined ? {} : { costMicros }) })),
      usage: { paidOperations: 2, costMicros: costs[next++] }, durationMs: 10, traceId: 'cost-fixture',
    } as Decision),
  } as EventClient
  createRoot(element).render(<Playground canEvaluate t={localize('en')} locale="en"
    sources={[]} client={client} refresh={() => {}} />)
}
