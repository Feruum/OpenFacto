import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, BookOpen, FlaskConical, Send, MessagesSquare, Check } from './icons'
import { appendConversation, type ConversationTurn, type Decision, type EvidenceRef } from '@openfacto/answer-engine'
import type { Locale } from '@openfacto/contracts'
import { Badge } from './components/arc/badge/badge'
import { Button } from './components/arc/button/button'
import { Evaluations } from './Evaluations'
import { Modal } from './ui'
import { ApiFailure, errorWord } from './api'
import { languageNames, type Translate, type Word } from './i18n'
import type { EventClient, Handoff, Question, Source, Version } from './workspace'
import { formatCost } from './workspace'

const deliveryLabels = {
  pending: 'deliveryQueued',
  sending: 'deliverySending',
  sent: 'deliverySent',
  failed: 'deliveryFailed',
  uncertain: 'deliveryUncertain',
} as const

type PlaygroundProps = {
  canEvaluate: boolean
  t: Translate
  locale: Locale
  sources: Source[]
  client: EventClient
  refresh: () => void
}

export function Playground(props: PlaygroundProps) {
  const [scope, setScope] = useState({ client: props.client, revision: 0 })
  if (scope.client !== props.client) setScope({ client: props.client, revision: scope.revision + 1 })
  return <PlaygroundSession key={scope.revision + '/' + props.locale} {...props} />
}

function PlaygroundSession({
  t,
  locale,
  sources,
  client,
  refresh,
  canEvaluate,
}: PlaygroundProps) {
  const [question, setQuestion] = useState(''),
    [language, setLanguage] = useState(locale),
    [mode, setMode] = useState<Question['mode']>('published_preview')
  const [faqOnly, setFaqOnly] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null),
    [result, setResult] = useState<Decision | null>(null)
  const [citation, setCitation] = useState<{ ref: EvidenceRef; version?: Version } | null>(null)
  const retry = useRef<{ signature: string; id: string; input: Question } | null>(null)
  const generation = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const renderedTiming = useRef<{ requestId: string; started: number } | null>(null)
  const [conversation, setConversation] = useState<ConversationTurn[]>([])
  const conversationAt = useRef(0)
  useEffect(() => {
    const requests = generation
    const active = activeRequest
    return () => {
      requests.current++
      active.current?.abort()
    }
  }, [])
  useEffect(() => {
    const timing = renderedTiming.current
    if (!result || !timing) return
    renderedTiming.current = null
    try {
      // Effects run after React commits the final decision to the DOM. Keep only
      // the latest timing entry; its metadata deliberately contains no content.
      performance.clearMeasures('openfacto.playground.send_to_render')
      performance.measure('openfacto.playground.send_to_render', {
        start: timing.started,
        end: performance.now(),
        detail: { requestId: timing.requestId, traceId: result.traceId },
      })
    } catch {
      // Diagnostics must never prevent an answer from being displayed.
    }
  }, [result])
  function clearContext() {
    generation.current++
    activeRequest.current?.abort()
    activeRequest.current = null
    renderedTiming.current = null
    setBusy(false)
    setConversation([])
    conversationAt.current = 0
    retry.current = null
    setResult(null)
    setCitation(null)
    setError(null)
  }
  function resetConversation() {
    clearContext()
    setQuestion('')
    setResult(null)
    setError(null)
  }
  async function inspect(ref: EvidenceRef) {
    const current = generation.current
    try {
      const version = (await client.versions(ref.sourceId)).find((v) => v.id === ref.versionId)
      if (current === generation.current) setCitation({ ref, version })
    } catch (e) {
      if (current === generation.current) setError(errorWord(e))
    }
  }
  async function run(e: FormEvent) {
    e.preventDefault()
    if (!question.trim() || busy) return
    const current = ++generation.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    renderedTiming.current = null
    const started = performance.now()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fields = { question: question.trim(), language, mode, faqOnly }
      const signature = JSON.stringify(fields)
      const previous = retry.current?.signature === signature ? retry.current : null
      const recent = previous?.input.conversation ?? (Date.now() - conversationAt.current < 10 * 60_000 ? conversation : [])
      const input = previous?.input ?? { ...fields, conversation: recent }
      const requestId = previous?.id ?? crypto.randomUUID()
      retry.current = { signature, id: requestId, input }
      const decision = await client.playground({ ...input, requestId }, controller.signal)
      if (current !== generation.current) return
      renderedTiming.current = { requestId, started }
      setResult(decision)
      if (['clarify', 'approved_faq', 'grounded_answer'].includes(decision.outcome)) {
        setConversation(appendConversation(recent, input.question, decision.answer))
        conversationAt.current = Date.now()
      } else {
        setConversation([])
        conversationAt.current = 0
      }
      retry.current = null
      refresh()
    } catch (e) {
      if (current !== generation.current || controller.signal.aborted) return
      if (e instanceof ApiFailure && e.status < 500) retry.current = null
      setError(errorWord(e))
    } finally {
      if (current === generation.current) {
        activeRequest.current = null
        setBusy(false)
      }
    }
  }
  const examples = sources
    .filter((s) => s.kind === 'faq' && s.publishedVersionId && s.visibility === 'participant')
    .slice(0, 2)
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>{t('playground')}</h1>
          <p>{t('playInfo')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={resetConversation} disabled={busy}>{t('newConversation')}</Button>
      </div>
      {conversation.length > 0 && (
        <details className="panel">
          <summary>{t('conversationContext')}</summary>
          {conversation.map((turn, index) => <div key={index}><p>{turn.question}</p><p>{turn.answer}</p></div>)}
        </details>
      )}
      <div className="test-grid">
        <form className="panel form" onSubmit={run}>
          <h2>
            <FlaskConical size={19} />
            {t('preview')}
          </h2>
          <fieldset disabled={busy}>
            <label>
              {t('question')}
              <textarea
                aria-label={t('question')}
                required
                maxLength={2000}
                rows={4}
                placeholder={t('ask')}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            {examples.length > 0 && (
              <div className="examples">
                {examples.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      clearContext()
                      setQuestion(s.title)
                      setLanguage(s.language)
                    }}
                  >
                    {s.title}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            )}
            <div className="field-pair">
              <label>
                {t('language')}
                <select value={language} onChange={(e) => { clearContext(); setLanguage(e.target.value as Locale) }}>
                  {Object.entries(languageNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('testMode')}
                <select value={mode} onChange={(e) => { clearContext(); setMode(e.target.value as Question['mode']) }}>
                  <option value="published_preview">{t('publishedOnly')}</option>
                  <option value="draft_preview">{t('drafts')}</option>
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={faqOnly} onChange={(e) => { clearContext(); setFaqOnly(e.target.checked) }} />
              {t('faqOnly')}
            </label>
            <Button type="submit" disabled={!question.trim()} loading={busy}>
              <Send size={15} />
              {t('tryPlay')}
            </Button>
          </fieldset>
          {error && <p role="alert">{t(error)}</p>}
        </form>
        <section className="panel result" aria-live="polite">
          <h2>
            <BookOpen size={19} />
            {t('answer')}
          </h2>
          {result ? (
            <>
              <Badge size="sm" tone="info">
                {t(result.outcome)}
              </Badge>
              <p className="response">{result.answer}</p>
              <h3>{t('evidence')}</h3>
              {result.sources.length ? (
                result.sources.map((c, i) => (
                  <div key={i} className="citation">
                    {sources.some((s) => s.id === c.sourceId) ? (
                      <button className="text-button" onClick={() => void inspect(c)}>
                        {c.title}
                        <ArrowUpRight size={14} />
                      </button>
                    ) : (
                      <strong>{c.title}</strong>
                    )}
                    <small>
                      {t('version')} <code>{c.versionId}</code>
                      {c.page ? ' · ' + t('page') + ' ' + c.page : ''}
                      {c.section ? ' · ' + c.section : ''}
                    </small>
                    {c.quote && <blockquote>{c.quote}</blockquote>}
                  </div>
                ))
              ) : (
                <p>{t('noEvidence')}</p>
              )}
              <details className="trace">
                <summary>{t('trace')}</summary>
                <p>{result.reasonCode}</p>
                <p>
                  {t('paid')} · {result.usage.paidOperations}
                  <br />
                  {t('cost')} ·{' '}
                  {formatCost(result.usage.costMicros, locale)}
                  <br />
                  {t('engineTime')} ·{' '}
                  {new Intl.NumberFormat(locale, { style: 'unit', unit: 'millisecond' }).format(
                    result.durationMs,
                  )}
                </p>
                <ol>
                  {result.steps.map((s, i) => (
                    <li key={i}>
                      {s.stage === 'candidate_rejected' ? t('candidate_rejected') : s.stage} ·{' '}
                      {['wrong_topic', 'different_deadline', 'missing_condition', 'contradicted'].includes(
                        s.reason,
                      )
                        ? t(s.reason as Word)
                        : s.reason}
                      {s.durationMs !== undefined && <small>{s.durationMs} ms · {s.costMicros ?? '—'} μUSD</small>}
                      {s.candidates.length > 0 && (
                        <ul>
                          {s.candidates.map((ref, j) => (
                            <li key={j}>
                              {ref.title}
                              {ref.page ? ' · ' + t('page') + ' ' + ref.page : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
                <small>
                  {t('traceId')} <code>{result.traceId}</code>
                </small>
              </details>
            </>
          ) : (
            <p className="muted">{t(busy ? 'playWorking' : 'playInfo')}</p>
          )}
        </section>
      </div>
      {canEvaluate && (
        <Evaluations client={client} question={question} language={language} sources={sources} t={t} />
      )}{' '}
      {citation && (
        <Modal title={citation.ref.title} t={t} close={() => setCitation(null)}>
          <p>
            {t('version')} · <code>{citation.ref.versionId}</code>
          </p>
          {citation.ref.page && (
            <p>
              {t('page')} · {citation.ref.page}
            </p>
          )}
          <p className="preserve">
            {citation.ref.quote ??
              citation.version?.body ??
              (citation.ref.kind === 'faq' ? result?.answer : t('noEvidence'))}
          </p>
          {citation.version?.ingestionStatus === 'ready' && client.download && (
            <Button
              variant="secondary"
              onClick={() =>
                void client.download!(citation.ref.sourceId, citation.ref.versionId).catch((e) =>
                  setError(errorWord(e)),
                )
              }
            >
              {t('appendix')}
            </Button>
          )}
        </Modal>
      )}
    </>
  )
}
export function Inbox({
  t,
  tickets,
  client,
  canReply,
  refresh,
  canAssign,
  locale,
}: {
  canAssign: boolean
  locale: Locale
  t: Translate
  tickets: Handoff[]
  client: EventClient
  canReply: boolean
  refresh: () => void
}) {
  const [filter, setFilter] = useState('open'),
    [editing, setEditing] = useState(''),
    [text, setText] = useState(''),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null)
  const [members, setMembers] = useState<{ id: string; displayName: string }[]>([])
  const [replyLanguage, setReplyLanguage] = useState(locale)
  useEffect(() => {
    let active = true
    if (canAssign && client.assignees)
      client
        .assignees()
        .then((rows) => {
          if (active) setMembers(rows.filter((r) => ['owner', 'admin', 'moderator'].includes(r.role)))
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    return () => {
      active = false
    }
  }, [client, canAssign])
  async function act(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  const rows = tickets.filter((row) => filter === 'all' || row.status === filter)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.reply(editing, text.trim(), create, replyLanguage)
      setEditing('')
      setFilter('resolved')
      refresh()
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>{t('inbox')}</h1>
          <p>{t('inboxInfo')}</p>
        </div>
      </div>
      <section className="panel">
        <div className="filterbar">
          <h2>
            <MessagesSquare size={19} />
            {t('inbox')}
          </h2>
          <Button variant="secondary" size="sm" onClick={refresh}>{t('refresh')}</Button>
          <select value={filter} aria-label={t('filters')} onChange={(e) => setFilter(e.target.value)}>
            {(['open', 'resolved', 'closed', 'all'] as const).map((f) => (
              <option key={f} value={f}>
                {t(f)}
              </option>
            ))}
          </select>
        </div>
        {!rows.length && <p className="empty">{t(filter === 'open' ? 'noTicket' : 'noMatch')}</p>}
        {rows.map((h) => (
          <article className="ticket" key={h.id}>
            <Badge tone={h.status === 'open' ? 'info' : 'neutral'} size="sm">
              {t(h.status)}
            </Badge>
            <h3>{h.question}</h3>
            {h.reply && <p className="preserve">{h.reply}</p>}
            {h.deliveryStatus && <p>{t(deliveryLabels[h.deliveryStatus])}</p>}
            {canAssign && client.assign && h.status === 'open' && (
              <label className="assign">
                {t('assign')}{' '}
                <select
                  disabled={busy}
                  value={h.assignedMembershipId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value
                    void act(() => client.assign!(h.id, id || null))
                  }}
                >
                  <option value="">{t('select')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {h.status === 'resolved' && client.faqDraft && !h.faqDraftId && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => client.faqDraft!(h.id, locale))}
              >
                {t('createDraft')}
              </Button>
            )}
            {h.status === 'open' &&
              canReply &&
              (editing === h.id ? (
                <form className="form" onSubmit={submit}>
                  <label>
                    {t('replyLabel')}
                    <textarea
                      required
                      rows={3}
                      maxLength={4000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <label>
                    {t('language')}
                    <select
                      value={replyLanguage}
                      onChange={(e) => setReplyLanguage(e.target.value as Locale)}
                    >
                      {Object.entries(languageNames).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
                    {t('createDraft')}
                  </label>
                  <Button type="submit" loading={busy}>
                    <Check size={14} />
                    {t('sendReply')}
                  </Button>
                  {error && <p role="alert">{t(error)}</p>}
                </form>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(h.id)
                    setText('')
                    setCreate(false)
                    setError(null)
                  }}
                >
                  {t('reply')}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            {h.status === 'open' && client.close && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void act(() => client.close!(h.id))}
              >
                {t('closeTicket')}
              </button>
            )}
          </article>
        ))}
        {error && !editing && <p role="alert">{t(error)}</p>}
      </section>
    </>
  )
}
