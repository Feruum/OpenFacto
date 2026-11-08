import type {
  CursorPage,
  EventDto,
  Locale,
  OrganizationDto,
  OrganizationRole,
  UserDto,
} from '@openfacto/contracts'
import type { Decision, Outcome, EvidenceRef, ConversationTurn } from '@openfacto/answer-engine'
import { apiRequest, downloadPdf } from './api'
import { requestPlayground } from './playground'

export function formatCost(costMicros: number | null | undefined, locale: Locale): string {
  return costMicros == null ? '—' : new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 6,
  }).format(costMicros / 1000000)
}

export type Organization = OrganizationDto & { role: OrganizationRole }
export type Session = { token: string; user: UserDto }
export type SourceInput = {
  kind: 'faq' | 'document'
  title: string
  body: string
  language: Locale
  visibility: 'participant' | 'internal'
  aliases: string[]
}
export type Source = SourceInput & { id: string; publishedVersionId: string | null; updatedAt: string }
export type Version = {
  id: string
  number: number
  title: string
  body: string
  createdAt: string
  pageDiagnostics?: { page: number; status: 'needs_ocr' | 'needs_text' }[]
  ingestionStatus?: string
}
export type Handoff = {
  id: string
  question: string
  status: 'open' | 'resolved' | 'closed'
  deliveryStatus?: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | null
  reply: string | null
  createdAt: string
  faqDraftId?: string | null
  assignedMembershipId?: string | null
}
export type Stats = {
  days?: number
  periodStart?: string
  byMode?: {
    mode: 'live' | 'published_preview' | 'draft_preview'
    runs: number
    outcomes: Record<string, number>
    reasons: Record<string, number>
    latencyMs: { p50: number | null; p95: number | null }
  }[]
  usage?: {
    settledOperations: number
    settledCostMicros: number
    reservedOperations: number
    reservedMicros: number
    uncertainOperations: number
    uncertainMicros: number
    platformCostMicros: number
    byokCostMicros: number
  }
  questions: number
  answered: number
  handoffs: number
  openHandoffs: number
  sources: number
  publishedSources: number
}
export type Question = {
  conversation?: ConversationTurn[]
  requestId?: string
  question: string
  language: Locale
  mode: 'published_preview' | 'draft_preview'
  faqOnly: boolean
}
export type Bot = {
  id: string
  name: string
  username: string
  active: boolean
  allowedChatIds: string[]
  aliases: string[]
  groupMode: 'off' | 'mention_only' | 'mention_or_name' | 'all_relevant'
  privateMode: 'off' | 'always'
}
export type Funding = { funding: 'platform' | 'byok'; hasKey: boolean; dailyLimitMicros: number }
export type BotInput = {
  name: string
  token: string
  webhookSecret: string
  allowedChatIds: string[]
  aliases: string[]
}
export type EvaluationCase = {
  question: string
  language: Locale
  expectedOutcome: Outcome
  expectedSourceId?: string
}
export type EvaluationRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  cases: EvaluationCase[]
  results: {
    index: number
    outcome: Outcome
    reasonCode: string
    passed: boolean
    costMicros: number | null
    durationMs: number
    sources: EvidenceRef[]
  }[]
  createdAt: string
}
export interface EventClient {
  evaluations?(): Promise<EvaluationRun[]>
  runEvaluation?(cases: EvaluationCase[]): Promise<EvaluationRun>
  evaluation?(id: string): Promise<EvaluationRun>
  sources(): Promise<Source[]>
  handoffs(): Promise<Handoff[]>
  analytics(days?: number): Promise<Stats>
  policy?(): Promise<{ faqOnly: boolean; handoffEnabled: boolean }>
  remove?(id: string): Promise<void>
  save(input: SourceInput, id?: string): Promise<Source>
  versions(id: string): Promise<Version[]>
  publish(id: string, versionId?: string): Promise<void>
  revoke(id: string): Promise<void>
  rollback(id: string, versionId: string): Promise<void>
  playground(input: Question, signal?: AbortSignal): Promise<Decision>
  reply(id: string, text: string, createFaqDraft: boolean, language: Locale): Promise<void>
  download?(id: string, version: string): Promise<void>
  close?(id: string): Promise<void>
  assign?(id: string, membershipId: string | null): Promise<void>
  assignees?(): Promise<{ id: string; displayName: string; role: OrganizationRole }[]>
  faqDraft?(id: string, language: Locale): Promise<void>
  upload?(id: string, pdfBase64: string): Promise<void>
  bots?(): Promise<Bot[]>
  connect?(data: BotInput): Promise<void>
  funding?(): Promise<Funding>
  saveFunding?(data: { funding: Funding['funding']; key?: string; dailyLimitMicros: number }): Promise<void>
}

export async function pages<T>(path: string, token: string): Promise<T[]> {
  const result: T[] = []
  let cursor: string | null = null
  do {
    const query: URLSearchParams = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)
    const page: CursorPage<T> = await apiRequest(path + '?' + query, token)
    result.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return result
}
export const organizations = (token: string) => pages<Organization>('/organizations', token)
export const events = (token: string, org: string) => pages<EventDto>(`/organizations/${org}/events`, token)
export function liveEvent(token: string, org: string, event: string): EventClient {
  const base = `/organizations/${org}/events/${event}`
  const send = <T>(path: string, body: unknown = {}, method = 'POST') =>
    apiRequest<T>(base + path, token, method, body)
  return {
    evaluations: () => pages(base + '/evaluations', token),
    runEvaluation: (cases) => send('/evaluations', { cases }),
    evaluation: (id) => apiRequest(base + '/evaluations/' + id, token),
    sources: () => pages(base + '/sources', token),
    handoffs: () => pages(base + '/handoffs', token),
    analytics: (days = 30) => apiRequest(base + '/analytics?days=' + days, token),
    policy: () => apiRequest(base, token),
    remove: (id) => apiRequest(base + '/sources/' + id, token, 'DELETE'),
    save: (data, id) => send(id ? `/sources/${id}` : '/sources', data, id ? 'PATCH' : 'POST'),
    versions: (id) => pages(base + `/sources/${id}/versions`, token),
    publish: (id, versionId) => send(`/sources/${id}/publish`, { versionId }),
    revoke: (id) => send(`/sources/${id}/revoke`),
    rollback: (id, versionId) => send(`/sources/${id}/rollback`, { versionId }),
    playground: (data, signal) => requestPlayground(base, token, data, signal),
    reply: (id, text, createFaqDraft, language) =>
      send(`/handoffs/${id}/reply`, { text, createFaqDraft, language }),
    download: (id, version) => downloadPdf(base + `/sources/${id}/versions/${version}/pdf`, token),
    assignees: () => pages(`/organizations/${org}/memberships`, token),
    faqDraft: (id, language) => send(`/handoffs/${id}/faq-draft`, { language }),
    close: (id) => send(`/handoffs/${id}/close`),
    assign: (id, membershipId) => send(`/handoffs/${id}/assign`, { membershipId }),
    upload: (id, pdfBase64) => send(`/sources/${id}/pdf`, { pdfBase64 }),
    bots: () => pages(base + '/bots', token),
    connect: (data) => send('/bots', data),
    funding: () => apiRequest(base + '/ai-settings', token),
    saveFunding: (data) => send('/ai-settings', data, 'PATCH'),
  }
}
