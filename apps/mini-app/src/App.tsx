import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Globe2,
  Inbox,
  LayoutDashboard,
  Menu,
  Settings2,
  X,
} from './icons'
import type { EventDto, Locale } from '@openfacto/contracts'
import { startSession } from './session'
import { errorWord } from './api'
import {
  events,
  liveEvent,
  organizations,
  type Session,
  type Organization,
  type EventClient,
  type Source,
  type Handoff,
  type Stats,
} from './workspace'
import { exampleEvent, exampleOrg, sampleClient } from './sample'
import { languageNames, localize, type Word } from './i18n'
import { canSee } from './access'
import { Overview, type Screen } from './Overview'
import { Knowledge, SourceEditor } from './Knowledge'
import { Inbox as Handoffs, Playground } from './Testing'
import { Settings } from './Settings'
import { Mark, ErrorNotice } from './ui'
import './App.css'
import './Mobile.css'
import './Workspace.css'

const links = [
  { key: 'overview', Icon: LayoutDashboard },
  { key: 'knowledge', Icon: BookOpen },
  { key: 'playground', Icon: FlaskConical },
  { key: 'inbox', Icon: Inbox },
  { key: 'settings', Icon: Settings2 },
] as const
function initialLocale(): Locale {
  const stored = localStorage.getItem('openfacto.language')
  return stored === 'kk' || stored === 'en' ? stored : 'ru'
}
function route(): Screen {
  const key = new URLSearchParams(location.search).get('view')
  return links.find((l) => l.key === key)?.key ?? 'overview'
}
function App() {
  const [locale, setLocale] = useState(initialLocale),
    [screen, setScreen] = useState<Screen>(route),
    [mobile, setMobile] = useState(false)
  const [session, setSession] = useState<Session | null | undefined>(undefined),
    [sessionTry, setSessionTry] = useState(0)
  const [orgs, setOrgs] = useState<Organization[]>([]),
    [eventRows, setEvents] = useState<EventDto[]>([])
  const [org, setOrg] = useState<Organization>(),
    [event, setEvent] = useState<EventDto>(),
    [loadError, setLoadError] = useState<Word | null>(null)
  const [scopeBusy, setScopeBusy] = useState(true)
  const scopeGeneration = useRef(0),
    t = localize(locale)
  const sample = useMemo(() => sampleClient(), [])
  const client = useMemo(
    () =>
      session === null
        ? sample
        : session && org && event
          ? liveEvent(session.token, org.id, event.id)
          : undefined,
    [session, org, event, sample],
  )
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const loadScope = useCallback(async (selectedSession: Session | null, orgId?: string, eventId?: string) => {
    const generation = ++scopeGeneration.current
    setScopeBusy(true)
    setLoadError(null)
    try {
      if (!selectedSession) {
        setOrgs([exampleOrg])
        setEvents([exampleEvent])
        setOrg(exampleOrg)
        setEvent(exampleEvent)
        return
      }
      const preferenceKey = 'openfacto.scope.' + selectedSession.user.id
      const available = await organizations(selectedSession.token)
      const organization =
        available.find((i) => i.id === (orgId ?? sessionStorage.getItem(preferenceKey))) ?? available[0]
      const items = organization ? await events(selectedSession.token, organization.id) : []
      if (scopeGeneration.current !== generation) return
      setOrgs(available)
      setOrg(organization)
      setEvents(items)
      const selection =
        items.find(
          (i) => i.id === (eventId ?? sessionStorage.getItem(preferenceKey + '.' + organization?.id)),
        ) ?? items[0]
      setEvent(selection)
      if (organization) sessionStorage.setItem(preferenceKey, organization.id)
      if (organization && selection)
        sessionStorage.setItem(preferenceKey + '.' + organization.id, selection.id)
    } catch (e) {
      if (scopeGeneration.current === generation) {
        setLoadError(errorWord(e))
        setOrg(undefined)
        setEvent(undefined)
        setEvents([])
      }
    } finally {
      if (scopeGeneration.current === generation) setScopeBusy(false)
    }
  }, [])
  useEffect(() => {
    let active = true
    startSession()
      .then((s) => {
        if (active) {
          setSession(s)
          void loadScope(s)
          if (s && !localStorage.getItem('openfacto.language')) setLocale(s.user.locale)
        }
      })
      .catch((e) => {
        if (active) setLoadError(errorWord(e))
      })
    return () => {
      active = false
    }
  }, [sessionTry, loadScope])

  useEffect(() => {
    const back = () => {
      setScreen(route())
      setMobile(false)
    }
    addEventListener('popstate', back)
    return () => removeEventListener('popstate', back)
  }, [])
  function navigate(next: Screen) {
    const url = new URL(location.href)
    url.searchParams.set('view', next)
    if (route() !== next) history.pushState(null, '', url)
    setScreen(next)
    setMobile(false)
    window.scrollTo({ top: 0 })
  }
  const chosen = !scopeBusy && session && (!org || !event) ? 'settings' : screen
  const currentTitle = t(chosen)
  const settings = (
    <Settings
      key={[org?.id, event?.id].join('/')}
      t={t}
      session={session ?? null}
      orgs={orgs}
      events={eventRows}
      org={org}
      event={event}
      client={client}
      chooseOrg={(id) => void loadScope(session ?? null, id)}
      chooseEvent={(id) => {
        setEvent(eventRows.find((e) => e.id === id))
        if (session && org) sessionStorage.setItem('openfacto.scope.' + session.user.id + '.' + org.id, id)
      }}
      reload={(orgId, eventId) => loadScope(session ?? null, orgId, eventId)}
    />
  )
  const brand = (
    <div className="brand">
      <Mark />
      <span>Openfacto</span>
    </div>
  )
  return (
    <div className="shell">
      <a href="#main-content" className="skip">
        {t('skip')}
      </a>
      <aside className={'sidebar ' + (mobile ? 'expanded' : '')}>
        <div className="brand-row">
          {brand}
          <button
            className="mobile-menu"
            aria-label={t('menu')}
            aria-expanded={mobile}
            aria-controls="workspace-navigation"
            onClick={() => setMobile((v) => !v)}
          >
            {mobile ? <X /> : <Menu />}
          </button>
        </div>
        <div className="side-body" id="workspace-navigation">
          <button className="space-switch" onClick={() => navigate('settings')}>
            <span className="org-icon">
              <Building2 size={18} />
            </span>
            <span>
              <small>{t('workspace')}</small>
              <strong>{org?.name ?? 'Openfacto'}</strong>
            </span>
            <ChevronDown size={15} />
          </button>
          <nav aria-label={t('menu')}>
            {links
              .filter(({ key }) => !org || canSee(key, org.role))
              .map(({ key, Icon }) => (
                <button
                  key={key}
                  aria-current={chosen === key ? 'page' : undefined}
                  className={chosen === key ? 'selected' : ''}
                  onClick={() => navigate(key)}
                >
                  <Icon size={18} />
                  {t(key)}
                </button>
              ))}
          </nav>
          <div className="account">
            <span className="account-icon">
              {session?.user.displayName.slice(0, 1).toUpperCase() ?? <FlaskConical size={18} />}
            </span>
            <div>
              <strong>{session?.user.displayName ?? t('demo')}</strong>
              <small>{org ? t(org.role) : t('organizer')}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="crumb">
            <Building2 size={15} />
            <span>{t('workspace')}</span>
            <ChevronRight size={13} />
            <b>{currentTitle}</b>
          </div>
          <div className="header-actions">
            <a className="product-home-link" href="/welcome">{locale === 'kk' ? 'Өнім туралы' : locale === 'en' ? 'About Openfacto' : 'О продукте'} ↗</a>
            {session === null && (
              <button className="demo-pill" onClick={() => navigate('settings')}>
                <i />
                {t('demo')}
              </button>
            )}
            <label className="locale">
              <Globe2 size={15} />
              <select
                aria-label={t('interfaceLanguage')}
                value={locale}
                onChange={(e) => {
                  const next = e.target.value as Locale
                  localStorage.setItem('openfacto.language', next)
                  setLocale(next)
                }}
              >
                {Object.entries(languageNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {loadError ? (
            <ErrorNotice
              t={t}
              message={t(loadError)}
              retry={() => {
                setLoadError(null)
                setScopeBusy(true)
                setSessionTry((v) => v + 1)
              }}
            />
          ) : scopeBusy || session === undefined ? (
            <p className="loading" role="status">
              <Activity size={18} />
              {t('load')}
            </p>
          ) : chosen === 'settings' || !client || !event || !org ? (
            settings
          ) : (
            <EventView
              key={org.id + '/' + event.id + '/' + chosen}
              t={t}
              locale={locale}
              org={org}
              event={event}
              client={client}
              screen={chosen}
              sample={!session}
              navigate={navigate}
            />
          )}
        </main>
      </div>
    </div>
  )
}

type EventProps = {
  t: ReturnType<typeof localize>
  locale: Locale
  org: Organization
  event: EventDto
  client: EventClient
  screen: Screen
  sample: boolean
  navigate: (screen: Screen) => void
}
function EventView({ t, locale, org, event, client, screen, sample, navigate }: EventProps) {
  const [sources, setSources] = useState<Source[]>([]),
    [tickets, setTickets] = useState<Handoff[]>([]),
    [stats, setStats] = useState<Stats>(),
    [revision, setRevision] = useState(0),
    [error, setError] = useState<Word | null>(null)
  const [days, setDays] = useState(30)
  const [editing, setEditing] = useState<Source | null | undefined>(undefined)
  const canEdit = ['owner', 'admin', 'editor'].includes(org.role),
    canReply = ['owner', 'admin', 'moderator'].includes(org.role)
  const refresh = () => setRevision((n) => n + 1)
  useEffect(() => {
    let active = true
    Promise.all([
      canEdit ? client.sources() : Promise.resolve([]),
      client.analytics(days),
      canReply ? client.handoffs() : Promise.resolve([]),
    ])
      .then(([s, a, h]) => {
        if (active) {
          setSources(s.sort((l, r) => r.updatedAt.localeCompare(l.updatedAt)))
          setError(null)
          setStats(a)
          setTickets(h)
        }
      })
      .catch((e) => {
        if (active) setError(errorWord(e))
      })
    return () => {
      active = false
    }
  }, [client, revision, canReply, canEdit, days])

  if (error) return <ErrorNotice t={t} message={t(error)} retry={refresh} />
  if (!stats) return <p role="status">{t('load')}</p>
  return (
    <>
      {screen === 'overview' && (
        <Overview
          event={event}
          orgName={org.name}
          sources={sources}
          stats={stats}
          days={days}
          setDays={setDays}
          t={t}
          sample={sample}
          role={org.role}
          navigate={navigate}
          edit={setEditing}
        />
      )}
      {screen === 'knowledge' && !canEdit && <p>{t('forbidden')}</p>}
      {screen === 'knowledge' && canEdit && (
        <Knowledge t={t} sources={sources} open={setEditing} canEdit={canEdit} />
      )}
      {screen === 'playground' && org.role === 'viewer' && <p>{t('forbidden')}</p>}
      {screen === 'playground' && org.role !== 'viewer' && (
        <Playground
          canEvaluate={canEdit}
          t={t}
          locale={locale}
          sources={sources}
          client={client}
          refresh={refresh}
        />
      )}
      {screen === 'inbox' &&
        (canReply ? (
          <Handoffs
            locale={locale}
            canAssign={org.role === 'owner' || org.role === 'admin'}
            t={t}
            tickets={tickets}
            client={client}
            refresh={refresh}
            canReply={canReply}
          />
        ) : (
          <p>{t('forbidden')}</p>
        ))}
      {editing !== undefined && (
        <SourceEditor
          initial={editing}
          client={client}
          locale={locale}
          t={t}
          canEdit={canEdit}
          refresh={refresh}
          close={() => setEditing(undefined)}
        />
      )}
    </>
  )
}
export default App
