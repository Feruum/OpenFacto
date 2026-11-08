import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Search, Layers, RotateCcw } from './icons'
import type { Locale } from '@openfacto/contracts'
import type { EventClient, Source, SourceInput, Version } from './workspace'
import type { Translate, Word } from './i18n'
import { languageNames } from './i18n'
import { errorWord } from './api'
import { Button } from './components/arc/button/button'
import { Modal, SourceList } from './ui'

export function Knowledge({
  sources,
  open,
  t,
  canEdit,
}: {
  sources: Source[]
  open: (s: Source | null) => void
  t: Translate
  canEdit: boolean
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all')
  const matched = sources.filter(
    (s) =>
      s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === 'all' || s.kind === filter),
  )
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>{t('knowledge')}</h1>
          <p>{t('sourceInfo')}</p>
        </div>
        {canEdit && (
          <Button onClick={() => open(null)}>
            <Plus size={17} />
            {t('add')}
          </Button>
        )}
      </div>
      <section className="panel">
        <div className="filterbar">
          <label className="search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
            />
          </label>
          <select aria-label={t('filters')} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{t('all')}</option>
            <option value="faq">FAQ</option>
            <option value="document">{t('document')}</option>
          </select>
        </div>
        {matched.length ? (
          <SourceList rows={matched} select={open} t={t} />
        ) : (
          <p className="empty">{t(sources.length ? 'noMatch' : 'noSources')}</p>
        )}
      </section>
    </>
  )
}

export function SourceEditor({
  initial,
  client,
  locale,
  canEdit,
  t,
  close,
  refresh,
}: {
  initial: Source | null
  client: EventClient
  locale: Locale
  canEdit: boolean
  t: Translate
  close: () => void
  refresh: () => void
}) {
  const [source, setSource] = useState(initial)
  const [draft, setDraft] = useState<SourceInput>(() =>
    initial
      ? pick(initial)
      : { kind: 'faq', title: '', body: '', language: locale, visibility: 'participant', aliases: [] },
  )
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join('\n'))
  const [versions, setVersions] = useState<Version[]>([]),
    [ticket, setTicket] = useState(0)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null),
    [message, setMessage] = useState<Word | null>(null)
  const [removing, setRemoving] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const dirty =
    source === null ||
    aliases !== (source.aliases ?? []).join('\n') ||
    JSON.stringify(pick(source)) !== JSON.stringify(draft)
  const update = <K extends keyof SourceInput>(key: K, value: SourceInput[K]) => {
    setDraft({ ...draft, [key]: value })
    setMessage(null)
  }
  useEffect(() => {
    let active = true
    if (source)
      client
        .versions(source.id)
        .then((v) => {
          if (active) setVersions(v.sort((a, b) => b.number - a.number))
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    return () => {
      active = false
    }
  }, [source, client, ticket])
  async function change(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await work()
      setTicket((n) => n + 1)
      refresh()
      setMessage('saved')
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  async function reload() {
    if (source) {
      const row = (await client.sources()).find((s) => s.id === source.id)
      if (row) {
        setSource(row)
        setDraft(pick(row))
      }
    }
  }
  function save(e: FormEvent) {
    e.preventDefault()
    void change(async () => {
      const result = await client.save(
        {
          ...draft,
          aliases: aliases
            .split('\n')
            .map((a) => a.trim())
            .filter(Boolean),
        },
        source?.id,
      )
      setSource(result)
      setDraft(pick(result))
      setAliases(result.aliases.join('\n'))
    })
  }
  return (
    <Modal
      title={source ? source.title : t('newSource')}
      t={t}
      close={() => {
        if (!busy) close()
      }}
    >
      <form className="form" onSubmit={save}>
        <fieldset disabled={busy || !canEdit}>
          <div className="field-pair">
            <label>
              {t('type')}
              <select
                value={draft.kind}
                disabled={!!source}
                onChange={(e) => update('kind', e.target.value as SourceInput['kind'])}
              >
                <option value="faq">FAQ</option>
                <option value="document">{t('document')}</option>
              </select>
            </label>
            <label>
              {t('language')}
              <select value={draft.language} onChange={(e) => update('language', e.target.value as Locale)}>
                {Object.entries(languageNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t('title')}
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </label>
          <label>
            {t('body')}
            <textarea
              required={draft.kind === 'faq'}
              maxLength={64000}
              rows={5}
              value={draft.body}
              onChange={(e) => update('body', e.target.value)}
            />
          </label>
          {draft.kind === 'faq' && (
            <label>
              {t('sourceAliases')}
              <textarea rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} />
            </label>
          )}
          <label>
            {t('visibility')}
            <select
              value={draft.visibility}
              onChange={(e) => update('visibility', e.target.value as SourceInput['visibility'])}
            >
              <option value="participant">{t('participant')}</option>
              <option value="internal">{t('internal')}</option>
            </select>
          </label>
          {canEdit && (
            <div className="actions">
              <Button type="submit" disabled={!dirty}>
                {t('save')}
              </Button>
              {source && !dirty && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void change(async () => {
                      await client.publish(source.id)
                      await reload()
                    })
                  }
                >
                  {t('publish')}
                </Button>
              )}
            </div>
          )}
        </fieldset>
      </form>
      {source && (
        <section className="history">
          <div className="section-head">
            <h3>
              <Layers size={16} />
              {t('versions')}
            </h3>
            {canEdit && source.publishedVersionId && (
              <button
                className="text-button"
                disabled={busy || dirty}
                onClick={() =>
                  void change(async () => {
                    await client.revoke(source.id)
                    await reload()
                  })
                }
              >
                {t('revoke')}
              </button>
            )}
          </div>
          <button className="text-button" type="button" onClick={() => setTicket((v) => v + 1)}>
            {t('refresh')}
          </button>
          {!versions.length && <p>{t('noVersions')}</p>}
          {versions.map((v) => (
            <details key={v.id}>
              <summary>
                v{v.number} · {v.title} {v.id === source.publishedVersionId ? ' · ' + t('activeVersion') : ''}
              </summary>
              <p className="preserve">{v.body}</p>
              {v.ingestionStatus && v.ingestionStatus !== 'none' && (
                <small>
                  {t(
                    v.ingestionStatus === 'ready'
                      ? 'readyPdf'
                      : v.ingestionStatus === 'failed'
                        ? 'failedCase'
                        : v.ingestionStatus === 'pending'
                          ? 'pending'
                          : v.ingestionStatus === 'uploading'
                            ? 'uploading'
                            : 'processing',
                  )}
                </small>
              )}
              {(['needs_ocr', 'needs_text'] as const).map((status) => {
                const pages = v.pageDiagnostics
                  ?.filter((p) => p.status === status)
                  .map((p) => p.page)
                  .sort((a, b) => a - b)
                return pages?.length ? (
                  <p key={status}>
                    {t(status)} · {pages.join(', ')}
                  </p>
                ) : null
              })}
              {v.ingestionStatus === 'ready' && client.download && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void client.download!(source.id, v.id).catch((e) => setError(errorWord(e)))}
                >
                  {t('appendix')}
                </Button>
              )}
              {canEdit && source.publishedVersionId !== v.id && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || dirty || !['ready', 'none', ''].includes(v.ingestionStatus ?? '')}
                  onClick={() =>
                    void change(async () => {
                      if (v.ingestionStatus === 'ready') await client.publish(source.id, v.id)
                      else await client.rollback(source.id, v.id)
                      await reload()
                    })
                  }
                >
                  <RotateCcw size={13} />
                  {t(v.ingestionStatus === 'ready' ? 'publish' : 'restore')}
                </Button>
              )}
            </details>
          ))}
        </section>
      )}
      {source?.kind === 'document' && canEdit && client.upload && (
        <div className="form">
          <label>
            {t('pdf')}
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null
                if (next && next.size > 8 * 1024 * 1024) {
                  setError('fileSize')
                  setFile(null)
                } else {
                  setError(null)
                  setFile(next)
                }
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!file || busy || dirty}
            onClick={() =>
              void change(async () => {
                if (!file || !client.upload) return
                const encoded = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onerror = reject
                  reader.onload = () => resolve(String(reader.result).split(',')[1]!)
                  reader.readAsDataURL(file)
                })
                await client.upload(source.id, encoded)
                await reload()
              })
            }
          >
            {t('pdf')}
          </Button>
        </div>
      )}
      {source && canEdit && client.remove && (
        <div className="history">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (!removing) {
                setRemoving(true)
                return
              }
              void change(async () => {
                await client.remove!(source.id)
                close()
              })
            }}
          >
            {t(removing ? 'confirm' : 'remove')}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="notice">
          {t(error)}
        </p>
      )}
      {message && <p role="status">{t(message)}</p>}
    </Modal>
  )
}
function pick(s: Source): SourceInput {
  return {
    kind: s.kind,
    title: s.title,
    body: s.body,
    language: s.language,
    visibility: s.visibility,
    aliases: s.aliases ?? [],
  }
}
