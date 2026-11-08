import { AnswerEngine, type Evidence } from '@openfacto/answer-engine'
import type { EventClient, EvaluationRun, Handoff, Source, SourceInput, Version } from './workspace'
import type { EventDto } from '@openfacto/contracts'
import type { Organization } from './workspace'

const at = '2026-10-14T09:30:00.000Z'
export const exampleOrg: Organization = {
  id: 'sample-org',
  name: 'Alatau Collective',
  role: 'owner',
  createdAt: at,
}
export const exampleEvent: EventDto = {
  id: 'sample-event',
  name: 'Alatau Summit',
  organizationId: exampleOrg.id,
  status: 'active',
  createdAt: at,
  updatedAt: at,
}

export function sampleClient(): EventClient {
  const sources: Source[] = []
  const history = new Map<string, (Version & SourceInput)[]>()
  const tickets: Handoff[] = [
    {
      id: 'sample-ticket-1',
      question: 'Можно ли приехать с командой после начала регистрации?',
      status: 'open',
      reply: null,
      createdAt: at,
    },
    {
      id: 'sample-ticket-2',
      question: 'Будет ли трансляция для удалённых участников?',
      status: 'open',
      reply: null,
      createdAt: at,
    },
  ]
  const source = (id: string) => {
    const s = sources.find((row) => row.id === id)
    if (!s) throw Error('Missing sample source')
    return s
  }
  function create(input: SourceInput) {
    const row = {
      ...input,
      id: crypto.randomUUID(),
      publishedVersionId: null,
      updatedAt: new Date().toISOString(),
    }
    sources.unshift(row)
    history.set(row.id, [])
    return row
  }
  function publish(id: string) {
    const row = source(id),
      versions = history.get(id)!
    const entry = {
      ...row,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      number: versions.length + 1,
    }
    versions.unshift(entry)
    row.publishedVersionId = entry.id
  }
  const seeds: [SourceInput['kind'], string, string, boolean][] = [
    ['document', 'Памятка волонтёра', 'Команда волонтёров встречается у стойки информации в 08:00.', false],
    [
      'faq',
      'Как получить бейдж?',
      'Покажите QR-код билета на стойке регистрации, чтобы получить бейдж.',
      true,
    ],
    [
      'document',
      'Программа мероприятия',
      'Открытие пройдёт в главном зале в 10:00. Начало секций в 11:00.',
      true,
    ],
    ['faq', 'Где проходит регистрация?', 'Регистрация проходит с 09:00 до 10:00 в фойе главного зала.', true],
  ]
  for (const [kind, title, body, live] of seeds) {
    const row = create({ kind, title, body, language: 'ru', visibility: 'participant', aliases: [] })
    if (live) publish(row.id)
  }
  const runs: EvaluationRun[] = []
  const client: EventClient = {
    async sources() {
      return sources.map((s) => ({ ...s }))
    },
    async handoffs() {
      return tickets.map((h) => ({ ...h }))
    },
    async analytics() {
      return {
        questions: tickets.length,
        answered: 0,
        handoffs: tickets.length,
        openHandoffs: tickets.filter((t) => t.status === 'open').length,
        sources: sources.length,
        publishedSources: sources.filter((s) => s.publishedVersionId).length,
      }
    },
    async save(input, id) {
      if (!id) return create(input)
      return Object.assign(source(id), input, { updatedAt: new Date().toISOString() })
    },
    async versions(id) {
      return [...(history.get(id) ?? [])]
    },
    async publish(id) {
      publish(id)
    },
    async revoke(id) {
      source(id).publishedVersionId = null
    },
    async rollback(id, versionId) {
      if (!history.get(id)?.some((v) => v.id === versionId)) throw Error('Missing sample version')
      source(id).publishedVersionId = versionId
    },
    async playground(input) {
      const evidence: Evidence[] = sources.flatMap((s) => {
        const draft = input.mode === 'draft_preview'
        const v = draft ? s : history.get(s.id)?.find((row) => row.id === s.publishedVersionId)
        return v
          ? [
              {
                ...v,
                sourceId: s.id,
                versionId: v.id,
                organizationId: exampleOrg.id,
                eventId: exampleEvent.id,
                state: draft ? 'draft' : 'published',
                text: v.body,
              },
            ]
          : []
      })
      const result = await AnswerEngine.run({
        ...input,
        organizationId: exampleOrg.id,
        eventId: exampleEvent.id,
        sources: evidence,
        traceId: crypto.randomUUID(),
        activated: true,
        handoffEnabled: true,
      })

      return result
    },
    async evaluations() {
      return [...runs]
    },
    async evaluation(id) {
      const run = runs.find((r) => r.id === id)
      if (!run) throw Error('Missing run')
      return run
    },
    async runEvaluation(cases) {
      const results: EvaluationRun['results'] = []
      for (const [index, c] of cases.entries()) {
        const start = performance.now()
        const d = await client.playground({
          question: c.question,
          language: c.language,
          mode: 'published_preview',
          faqOnly: false,
        })
        results.push({
          index,
          outcome: d.outcome,
          reasonCode: d.reasonCode,
          costMicros: d.usage.costMicros,
          durationMs: Math.round(performance.now() - start),
          sources: d.sources,
          passed:
            d.outcome === c.expectedOutcome &&
            (!c.expectedSourceId || d.sources.some((s) => s.sourceId === c.expectedSourceId)),
        })
      }
      const run: EvaluationRun = {
        id: crypto.randomUUID(),
        status: 'completed',
        cases: [...cases],
        results,
        createdAt: new Date().toISOString(),
      }
      runs.unshift(run)
      return run
    },
    async close(id) {
      const ticket = tickets.find((t) => t.id === id)
      if (!ticket) throw Error('Ticket missing')
      ticket.status = 'closed'
    },
    async faqDraft(id, language) {
      const ticket = tickets.find((t) => t.id === id)
      if (!ticket?.reply) throw Error('Missing reply')
      if (!ticket.faqDraftId)
        ticket.faqDraftId = create({
          kind: 'faq',
          title: ticket.question,
          body: ticket.reply,
          language,
          visibility: 'participant',
          aliases: [],
        }).id
    },
    async reply(id, text, createFaqDraft, language) {
      const ticket = tickets.find((t) => t.id === id)
      if (!ticket || ticket.status !== 'open') throw Error('Ticket unavailable')
      ticket.status = 'resolved'
      ticket.reply = text
      if (createFaqDraft) await client.faqDraft!(id, language)
    },
  }
  return client
}
