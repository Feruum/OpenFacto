import { API_PREFIX, isReadyResponse, type ReadyResponse } from '@openfacto/contracts'
import type { Word } from './i18n'
const parsed = new URL(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000')
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  parsed.hash
) {
  throw new Error('Invalid VITE_API_BASE_URL')
}
export async function getReadiness(signal?: AbortSignal): Promise<ReadyResponse> {
  const response = await fetch(new URL('/health/ready', parsed), {
    signal,
    cache: 'no-store',
    credentials: 'omit',
  })
  const body: unknown = await response.json()
  if ((response.status !== 200 && response.status !== 503) || !isReadyResponse(body))
    throw new Error('Invalid API health response')
  return body
}
export class ApiFailure extends Error {
  status: number
  constructor(status: number) {
    super('API request failed')
    this.status = status
  }
}
export class PlaygroundPending extends Error {}
export function errorWord(error: unknown): Word {
  if (error instanceof PlaygroundPending) return 'playPending'
  if (!(error instanceof ApiFailure)) return 'failed'
  return (
    (
      { 400: 'validation', 401: 'expired', 403: 'forbidden', 409: 'conflict', 429: 'limit' } as Record<
        number,
        Word
      >
    )[error.status] ?? 'failed'
  )
}
export async function apiRequest<T>(
  path: string,
  token?: string,
  method = 'GET',
  body?: unknown,
  timeoutMs = 45000,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  try {
    const response = await fetch(new URL(API_PREFIX + path, parsed), {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new ApiFailure(response.status)
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : (undefined as T)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function downloadPdf(path: string, token: string) {
  const response = await fetch(new URL(API_PREFIX + path, parsed), {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw new ApiFailure(response.status)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = 'document.pdf'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
