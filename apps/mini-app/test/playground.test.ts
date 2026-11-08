import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveEvent, type Question } from '../src/workspace'
import { errorWord } from '../src/api'

const input: Question = {
  requestId: 'request-one', question: 'Where is check-in?', language: 'en',
  mode: 'published_preview', faqOnly: false,
}
const decision = { outcome: 'approved_faq', answer: 'Main hall', sources: [] }
const response = (status: string, extra = {}) => new Response(JSON.stringify({
  requestId: input.requestId, status, ...extra,
}), { status: status === 'pending' ? 202 : 200 })

describe('durable Playground requests', () => {
  const network = vi.fn<typeof fetch>()
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', network); network.mockReset() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('returns an already completed POST immediately without polling', async () => {
    network.mockResolvedValueOnce(response('completed', { decision }))
    const started = Date.now()
    expect(await liveEvent('secret', 'org', 'event').playground(input)).toEqual(decision)
    expect(Date.now()).toBe(started)
    expect(network).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('polls every 300ms for the first 15 seconds then every 1000ms', async () => {
    const times: number[] = []
    const started = Date.now()
    network.mockImplementation(async () => {
      times.push(Date.now() - started)
      return response(times.length === 53 ? 'completed' : 'pending', { decision })
    })
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    expect(times.slice(0, 4)).toEqual([0, 300, 600, 900])
    expect(times.slice(-4)).toEqual([14700, 15000, 16000, 17000])
  })

  it('bases the fast polling window on original send and never overlaps slow requests', async () => {
    const times: number[] = []
    const started = Date.now()
    let active = 0
    let maximum = 0
    network.mockImplementation(async () => {
      times.push(Date.now() - started)
      maximum = Math.max(maximum, ++active)
      await new Promise(resolve => setTimeout(resolve, 8000))
      active--
      return response(times.length === 3 ? 'completed' : 'pending', { decision })
    })
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    expect(times).toEqual([0, 8300, 17300])
    expect(maximum).toBe(1)
  })

  it('aborts a pending wait without another request or timer', async () => {
    network.mockResolvedValue(response('pending'))
    const controller = new AbortController()
    const result = liveEvent('secret', 'org', 'event').playground(input, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight request without retrying or leaving timers', async () => {
    let requestSignal: AbortSignal | undefined
    network.mockImplementation((_, options) => new Promise((_, reject) => {
      requestSignal = options?.signal as AbortSignal
      requestSignal.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
    }))
    const controller = new AbortController()
    const result = liveEvent('secret', 'org', 'event').playground(input, controller.signal).catch(error => error)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(requestSignal?.aborted).toBe(true)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(network).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not submit when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = liveEvent('secret', 'org', 'event').playground(input, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(network).not.toHaveBeenCalled()
    expect(await result).toMatchObject({ name: 'AbortError' })
  })

  it('aborts an in-flight GET after acceptance without resubmitting', async () => {
    let requestSignal: AbortSignal | undefined
    network.mockResolvedValueOnce(response('pending')).mockImplementation((_, options) => new Promise((_, reject) => {
      requestSignal = options?.signal as AbortSignal
      requestSignal.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
    }))
    const controller = new AbortController()
    const result = liveEvent('secret', 'org', 'event').playground(input, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(300)
    controller.abort()
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
    expect(network.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'GET'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never retries a fetch AbortError', async () => {
    network.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const result = liveEvent('secret', 'org', 'event').playground(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('keeps 1500ms error backoff and the original deadline despite network failures', async () => {
    const started = Date.now()
    const times: number[] = []
    network.mockImplementation(async () => {
      times.push(Date.now() - started)
      throw new TypeError('offline')
    })
    const result = liveEvent('secret', 'org', 'event').playground(input).catch(errorWord)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await result).toBe('playPending')
    expect(times.slice(0, 3)).toEqual([0, 1500, 3000])
    expect(times.at(-1)).toBe(298500)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts hung fetches at the fixed deadline and clears request timers', async () => {
    network.mockImplementation((_, options) => new Promise((_, reject) => {
      const signal = options?.signal as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const result = liveEvent('secret', 'org', 'event').playground(input).catch(errorWord)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await result).toBe('playPending')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([2100, 4700, 15100])('compares detection delay and GET count at server-ready time %ims', async (readyAt) => {
    const started = Date.now()
    let gets = 0
    network.mockImplementation(async (_, options) => {
      if (options?.method === 'GET') gets++
      return response(Date.now() - started >= readyAt ? 'completed' : 'pending', { decision })
    })
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    const elapsed = Date.now() - started
    // Legacy was a sequential 1500ms wait after each response, with identical zero RTT.
    const legacyGets = Math.ceil(readyAt / 1500)
    const comparison = { readyAt, legacyGets, legacyDelay: legacyGets * 1500 - readyAt,
      gets, delay: elapsed - readyAt }
    expect(comparison).toEqual({
      2100: { readyAt: 2100, legacyGets: 2, legacyDelay: 900, gets: 7, delay: 0 },
      4700: { readyAt: 4700, legacyGets: 4, legacyDelay: 1300, gets: 16, delay: 100 },
      15100: { readyAt: 15100, legacyGets: 11, legacyDelay: 1400, gets: 51, delay: 900 },
    }[readyAt])
  })

  it('waits for pending and running jobs, then returns only the completed decision', async () => {
    network.mockResolvedValueOnce(response('pending'))
      .mockResolvedValueOnce(response('running'))
      .mockResolvedValueOnce(response('completed', { decision }))
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    expect(network.mock.calls.map(([url, options]) => [new URL(String(url)).pathname, options?.method])).toEqual([
      ['/api/v1/organizations/org/events/event/playground', 'POST'],
      ['/api/v1/organizations/org/events/event/playground/request-one', 'GET'],
      ['/api/v1/organizations/org/events/event/playground/request-one', 'GET'],
    ])
    expect(network.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer secret' })
  })

  it('reports a failed job without interpreting it as an answer', async () => {
    network.mockResolvedValueOnce(response('pending')).mockResolvedValueOnce(response('failed', { errorCode: 'job_failed' }))
    const result = liveEvent('secret', 'org', 'event').playground(input).catch(errorWord)
    await vi.runAllTimersAsync()
    expect(await result).toBe('failed')
  })

  it('maps revoked access to the existing access message', async () => {
    network.mockResolvedValueOnce(response('failed', { errorCode: 'access_changed' }))
    expect(await liveEvent('secret', 'org', 'event').playground(input).catch(errorWord)).toBe('forbidden')
  })

  it('bounds waiting to five minutes and retries with the original request ID', async () => {
    network.mockImplementation(async () => response('pending'))
    const client = liveEvent('secret', 'org', 'event')
    const started = Date.now()
    const first = client.playground(input).catch(errorWord)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await first).toBe('playPending')
    expect(Date.now() - started).toBe(300_000)
    network.mockResolvedValueOnce(response('completed', { decision }))
    expect(await client.playground(input)).toEqual(decision)
    const posts = network.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts.map(([, options]) => JSON.parse(String(options?.body)).requestId)).toEqual(['request-one', 'request-one'])
  })

  it('retries a lost submission response with the identical payload', async () => {
    network.mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(response('completed', { decision }))
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    expect(network.mock.calls[0][1]?.body).toBe(network.mock.calls[1][1]?.body)
  })

  it('recovers a transient polling error without submitting another job', async () => {
    network.mockResolvedValueOnce(response('pending')).mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response('completed', { decision }))
    const result = liveEvent('secret', 'org', 'event').playground(input)
    await vi.runAllTimersAsync()
    expect(await result).toEqual(decision)
    expect(network.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })
})
