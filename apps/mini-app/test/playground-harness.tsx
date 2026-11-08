import { createRoot } from 'react-dom/client'
import { Playground } from '../src/Testing'
import { localize } from '../src/i18n'
import { PlaygroundPending } from '../src/api'
import type { EventClient, Question } from '../src/workspace'
import type { Decision } from '@openfacto/answer-engine'
import type { Locale } from '@openfacto/contracts'

export function mount() {
  document.getElementById('root')!.style.display = 'none'
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const calls: Question[] = []
  const signals: (AbortSignal | undefined)[] = []
  const pending: { resolve: (decision: Decision) => void; reject: (error: Error) => void }[] = []
  let locale: Locale = 'en'
  const client = () => ({ playground: (input: Question, signal?: AbortSignal) => {
    calls.push(input)
    signals.push(signal)
    return new Promise<Decision>((resolve, reject) => pending.push({ resolve, reject }))
  } }) as EventClient
  let currentClient = client()
  const render = () => root.render(<Playground canEvaluate={false} t={localize(locale)} locale={locale}
    sources={[]} client={currentClient} refresh={() => {}} />)
  render()
  return {
    calls,
    signals,
    unmount() { root.unmount() },
    finish(answer = 'Main hall') {
      pending.shift()!.resolve({ outcome: 'approved_faq', answer, sources: [], steps: [],
        usage: { paidOperations: 0, costMicros: 0 }, durationMs: 1, traceId: 'test' } as Decision)
    },
    timeout() { pending.shift()!.reject(new PlaygroundPending()) },
    changeEvent() { currentClient = client(); render() },
    changeLocale() { locale = 'ru'; render() },
  }
}
