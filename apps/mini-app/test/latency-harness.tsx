import { createRoot } from 'react-dom/client'
import { Playground } from '../src/Testing'
import { requestPlayground } from '../src/playground'
import { localize } from '../src/i18n'
import type { EventClient } from '../src/workspace'

/** Real component and HTTP polling; the browser runner supplies a controlled server. */
export function mount() {
  document.getElementById('root')!.style.display = 'none'
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const client = { playground: (input, signal) => requestPlayground('/latency-fixture', '', input, signal) } as EventClient
  root.render(<Playground canEvaluate={false} t={localize('en')} locale="en"
    sources={[]} client={client} refresh={() => {}} />)
  return { unmount() { root.unmount() } }
}
