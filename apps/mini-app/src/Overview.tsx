import { ArrowRight, ArrowUpRight, BookOpen, FlaskConical, Inbox, MessageSquare, MapPin } from './icons'
import { canSee } from './access'
import type { EventDto, OrganizationRole } from '@openfacto/contracts'
import type { Source, Stats } from './workspace'
import { Button } from './components/arc/button/button'
import type { Translate } from './i18n'
import { Landscape, SourceList } from './ui'

const usd = (micros: number) =>
  new Intl.NumberFormat(document.documentElement.lang, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  }).format(micros / 1000000)
export type Screen = 'overview' | 'knowledge' | 'playground' | 'inbox' | 'settings'
export function Overview({
  event,
  orgName,
  stats,
  days,
  setDays,
  sources,
  sample,
  t,
  role,
  navigate,
  edit,
}: {
  event: EventDto
  orgName: string
  days: number
  setDays: (n: number) => void
  stats: Stats
  sources: Source[]
  sample: boolean
  role: OrganizationRole
  t: Translate
  navigate: (s: Screen) => void
  edit: (s: Source) => void
}) {
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>{t('overviewTitle')}</h1>
          <p>{t('overviewLine')}</p>
        </div>
      </div>
      <section className="event-banner">
        <Landscape />
        <div className="banner-content">
          <span className="banner-status">
            <i />
            {t(event.status)}
          </span>
          <h2>{event.name}</h2>
          <p>
            <MapPin size={16} />
            {sample ? t('almaty') + ' · ' + orgName : orgName}
          </p>
        </div>
      </section>
      <div className="metrics">
        {[
          { title: 'sources' as const, value: stats.sources, Icon: BookOpen, to: 'knowledge' as const },
          {
            title: 'questions' as const,
            value: stats.questions,
            Icon: MessageSquare,
            to: 'playground' as const,
          },
          { title: 'openTickets' as const, value: stats.openHandoffs, Icon: Inbox, to: 'inbox' as const },
        ].map(({ title, value, Icon, to }) => (
          <button key={title} disabled={!canSee(to, role)} onClick={() => navigate(to)}>
            <span className="metric-label">
              <Icon size={17} />
              {t(title)}
            </span>
            <span className="metric-value">
              {value}
              {canSee(to, role) && <ArrowUpRight size={16} />}
            </span>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        {canSee('knowledge', role) && (
          <section className="panel source-panel">
            <div className="section-head">
              <h2>{t('overviewSources')}</h2>
              <button className="text-button" onClick={() => navigate('knowledge')}>
                {t('allSources')}
                <ArrowRight size={14} />
              </button>
            </div>
            {sources.length ? (
              <SourceList rows={sources.slice(0, 4)} t={t} select={edit} />
            ) : (
              <p className="empty">
                {t('noSources')} {t('publishedHelp')}
              </p>
            )}
          </section>
        )}
        {canSee('playground', role) && (
          <section className="try-panel">
            <span className="try-icon">
              <FlaskConical size={23} />
            </span>
            <h2>{t('playground')}</h2>
            <p>{t('exampleDesc')}</p>
            <Button variant="secondary" onClick={() => navigate('playground')}>
              {t('tryPlay')}
              <ArrowUpRight size={15} />
            </Button>
          </section>
        )}
      </div>
      {stats.byMode && (
        <details className="panel evaluation">
          <summary>{t('analytics')}</summary>
          <div className="history">
            <label>
              {t('days')}{' '}
              <select aria-label={t('days')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 7, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            {t('answered')} · {stats.answered} / {stats.questions}
          </p>
          {stats.byMode.map((m) => (
            <details key={m.mode}>
              <summary>
                {t(m.mode)} · {m.runs}
              </summary>
              <dl className="analytics-list">
                <dt>{t('duration')} (p50 / p95)</dt>
                <dd>
                  {m.latencyMs.p50 ?? '—'} / {m.latencyMs.p95 ?? '—'} ms
                </dd>
                {!!Object.keys(m.outcomes).length && (
                  <>
                    <dt>{t('decisions')}</dt>
                    <dd>
                      {Object.entries(m.outcomes).map(([k, n]) => (
                        <div key={k}>
                          {k} · {n}
                        </div>
                      ))}
                    </dd>
                  </>
                )}
                {!!Object.keys(m.reasons).length && (
                  <>
                    <dt>{t('reasons')}</dt>
                    <dd>
                      {Object.entries(m.reasons).map(([k, n]) => (
                        <div key={k}>
                          {k} · {n}
                        </div>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </details>
          ))}
          {stats.usage && (
            <dl className="analytics-list">
              {[
                [t('paid'), stats.usage.settledOperations],
                [t('cost'), usd(stats.usage.settledCostMicros)],
                [t('reserved'), usd(stats.usage.reservedMicros)],
                [t('uncertain'), usd(stats.usage.uncertainMicros)],
                [t('platform'), usd(stats.usage.platformCostMicros)],
                ['BYOK', usd(stats.usage.byokCostMicros)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
      )}
    </>
  )
}
