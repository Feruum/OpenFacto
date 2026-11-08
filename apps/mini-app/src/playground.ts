import type { Decision } from '@openfacto/answer-engine'
import { ApiFailure, apiRequest, PlaygroundPending } from './api'
import type { Question } from './workspace'

type Job = {
  requestId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  decision?: Decision
  errorCode?: string
}

/** Submit once and follow the durable job. Retransmissions retain the same identity. */
export async function requestPlayground(base: string, token: string, input: Question, signal?: AbortSignal): Promise<Decision> {
  signal?.throwIfAborted()
  const body = { ...input, requestId: input.requestId ?? crypto.randomUUID() }
  const started = Date.now()
  const deadline = started + 5 * 60_000
  let accepted = false
  while (Date.now() < deadline) {
    let job: Job
    try {
      job = await apiRequest<Job>(
        base + '/playground' + (accepted ? '/' + encodeURIComponent(body.requestId) : ''),
        token,
        accepted ? 'GET' : 'POST',
        accepted ? undefined : body,
        Math.min(15_000, deadline - Date.now()),
        signal,
      )
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (error instanceof ApiFailure && error.status < 500) throw error
      await wait(deadline, 1500, signal)
      continue
    }
    signal?.throwIfAborted()
    if (Date.now() >= deadline) break
    if (job.requestId !== body.requestId) throw new ApiFailure(502)
    if (job.status === 'completed') {
      if (!job.decision) throw new ApiFailure(502)
      return job.decision
    }
    if (job.status === 'failed') throw new ApiFailure(job.errorCode === 'access_changed' ? 403 : 422)
    if (job.status !== 'pending' && job.status !== 'running') throw new ApiFailure(502)
    accepted = true
    await wait(deadline, Date.now() - started < 15_000 ? 300 : 1000, signal)
  }
  throw new PlaygroundPending()
}

function wait(deadline: number, intervalMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const delay = Math.max(0, Math.min(intervalMs, deadline - Date.now()))
  if (!delay) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
