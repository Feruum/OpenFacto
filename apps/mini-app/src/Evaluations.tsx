import { useEffect, useState } from 'react'
import { ListChecks, Plus, Play, X } from './icons'
import type { Locale } from '@openfacto/contracts'
import type { Outcome } from '@openfacto/answer-engine'
import type { EventClient, EvaluationCase, EvaluationRun, Source } from './workspace'
import { formatCost } from './workspace'
import { Button } from './components/arc/button/button'
import { errorWord } from './api'
import { languageNames, type Translate, type Word } from './i18n'

const choices: Outcome[] = ['approved_faq', 'grounded_answer', 'clarify', 'handoff', 'refuse']
export function Evaluations({
  client,
  question,
  language,
  sources,
  t,
}: {
  client: EventClient
  question: string
  language: Locale
  sources: Source[]
  t: Translate
}) {
  const [cases, setCases] = useState<(EvaluationCase & { id: string })[]>([]),
    [runs, setRuns] = useState<EvaluationRun[]>([]),
    [selected, setSelected] = useState<EvaluationRun | null>(null)
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null),
    [generation, refresh] = useState(0)
  useEffect(() => {
    let active = true
    if (open && client.evaluations)
      client
        .evaluations()
        .then((data) => {
          if (active) setRuns(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    return () => {
      active = false
    }
  }, [open, client, generation])
  useEffect(() => {
    if (!open || !selected || !['pending', 'running'].includes(selected.status) || !client.evaluation) return
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const next = await client.evaluation!(selected.id)
        if (active) {
          setSelected(next)
          if (['completed', 'failed'].includes(next.status)) refresh((n) => n + 1)
        }
      } catch (e) {
        if (active) setError(errorWord(e))
      }
    }, 2000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [selected, client, open])
  function add() {
    if (cases.length < 20)
      setCases([...cases, { id: crypto.randomUUID(), question, language, expectedOutcome: 'approved_faq' }])
  }
  function edit(id: string, patch: Partial<EvaluationCase>) {
    setCases(cases.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }
  async function run() {
    if (!client.runEvaluation || busy || !cases.length) return
    setBusy(true)
    setError(null)
    try {
      const result = await client.runEvaluation(
        cases.map((c) => ({
          question: c.question.trim(),
          language: c.language,
          expectedOutcome: c.expectedOutcome,
          expectedSourceId: c.expectedSourceId || undefined,
        })),
      )
      setSelected(result)
      refresh((n) => n + 1)
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  async function inspect(id: string) {
    if (!client.evaluation) return
    setBusy(true)
    try {
      setSelected(await client.evaluation(id))
      setError(null)
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="panel evaluation" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <ListChecks size={19} />
        {t('evaluations')}
      </summary>
      {open && (
        <>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void run()
            }}
          >
            <fieldset disabled={busy}>
              {cases.map((c, i) => (
                <div className="eval-case" key={c.id}>
                  <div className="section-head">
                    <strong>
                      {t('question')} {i + 1}
                    </strong>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setCases(cases.filter((v) => v.id !== c.id))}
                      aria-label={t('remove') + ' ' + (i + 1)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <label>
                    {t('question')}
                    <textarea
                      required
                      maxLength={2000}
                      value={c.question}
                      rows={2}
                      onChange={(e) => edit(c.id, { question: e.target.value })}
                    />
                  </label>
                  <div className="field-pair">
                    <label>
                      {t('language')}
                      <select
                        value={c.language}
                        onChange={(e) => edit(c.id, { language: e.target.value as Locale })}
                      >
                        {Object.entries(languageNames).map(([k, n]) => (
                          <option key={k} value={k}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('expected')}
                      <select
                        value={c.expectedOutcome}
                        onChange={(e) => edit(c.id, { expectedOutcome: e.target.value as Outcome })}
                      >
                        {choices.map((k) => (
                          <option key={k} value={k}>
                            {t(k)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    {t('expectedSource')}
                    <select
                      value={c.expectedSourceId ?? ''}
                      onChange={(e) => edit(c.id, { expectedSourceId: e.target.value || undefined })}
                    >
                      <option value="">{t('anySource')}</option>
                      {sources
                        .filter((s) => s.publishedVersionId && s.visibility === 'participant')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              ))}
              <div className="actions">
                <Button type="button" variant="secondary" disabled={cases.length >= 20} onClick={add}>
                  <Plus size={15} />
                  {t('addCase')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    selected?.status === 'pending' ||
                    selected?.status === 'running' ||
                    !cases.length ||
                    cases.some((c) => !c.question.trim())
                  }
                >
                  <Play size={15} />
                  {t('runSuite')}
                </Button>
              </div>
              <small>{t('costNote')}</small>
            </fieldset>
          </form>
          {error && (
            <p role="alert" className="notice">
              {t(error)}
            </p>
          )}
          {runs.length > 0 && (
            <div className="history">
              <label>
                {t('previousRuns')}{' '}
                <select
                  aria-label={t('previousRuns')}
                  disabled={busy}
                  value={selected?.id ?? ''}
                  onChange={(e) => void inspect(e.target.value)}
                >
                  <option value="" disabled>
                    {t('select')}
                  </option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleString(language)} ·{' '}
                      {t(r.status === 'failed' ? 'failedCase' : r.status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {selected && (
            <section className="history" aria-live="polite">
              <h3>{t(selected.status === 'failed' ? 'failedCase' : selected.status)}</h3>
              {selected.results.map((row) => {
                const c = selected.cases[row.index]
                return (
                  <details key={row.index}>
                    <summary>
                      {t(row.passed ? 'passed' : 'failedCase')} · {c?.question}
                    </summary>
                    <p>
                      {t('expected')} · {c ? t(c.expectedOutcome) : '—'}
                      <br />
                      {t('actual')} · {t(row.outcome)}
                      <br />
                      {row.reasonCode}
                      <br />
                      {t('duration')} ·{' '}
                      {new Intl.NumberFormat(language, { style: 'unit', unit: 'millisecond' }).format(
                        row.durationMs,
                      )}
                      <br />
                      {t('cost')} ·{' '}
                      {formatCost(row.costMicros, language)}
                    </p>
                    {row.sources.map((s, i) => (
                      <p key={i}>
                        {s.title} · <code>{s.versionId}</code>
                      </p>
                    ))}
                  </details>
                )
              })}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setCases(selected.cases.map((c) => ({ ...c, id: crypto.randomUUID() })))}
              >
                {t('repeat')}
              </Button>
            </section>
          )}
        </>
      )}
    </details>
  )
}
