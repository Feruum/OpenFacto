import { useEffect, useState, type FormEvent } from 'react'
import type { EventDto } from '@openfacto/contracts'
import { Activity, Building2, Radio, SlidersHorizontal } from './icons'
import { Button } from './components/arc/button/button'
import { getReadiness, errorWord, apiRequest } from './api'
import type { EventClient, Funding, Organization, Session, Bot } from './workspace'
import { Administration } from './Administration'
import { logout } from './session'
import type { Translate, Word } from './i18n'

type Props = {
  t: Translate
  session: Session | null
  orgs: Organization[]
  events: EventDto[]
  org?: Organization
  event?: EventDto
  client?: EventClient
  chooseOrg: (id: string) => void
  chooseEvent: (id: string) => void
  reload: (orgId?: string, eventId?: string) => Promise<void>
}
export function Settings({
  t,
  session,
  orgs,
  events,
  org,
  event,
  client,
  chooseOrg,
  chooseEvent,
  reload,
}: Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null),
    [message, setMessage] = useState<Word | null>(null)
  const [bots, setBots] = useState<Bot[]>([]),
    [fund, setFund] = useState<Funding | null>(null),
    [rev, setRev] = useState(0)
  const [policy, setPolicy] = useState<{ faqOnly: boolean; handoffEnabled: boolean } | null>(null)
  const manages = org?.role === 'owner' || org?.role === 'admin'
  useEffect(() => {
    let active = true
    if (manages && client?.policy)
      client
        .policy()
        .then((p) => {
          if (active) setPolicy(p)
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    if (manages && client?.bots)
      client
        .bots()
        .then((b) => {
          if (active) setBots(b)
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    if (manages && client?.funding)
      client
        .funding()
        .then((f) => {
          if (active) setFund(f)
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    return () => {
      active = false
    }
  }, [client, manages, rev])
  async function perform(work: () => Promise<void>, success: Word = 'saved') {
    if (busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await work()
      setMessage(success)
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  const base = org && event ? `/organizations/${org.id}/events/${event.id}` : ''
  const entries = (s: string) =>
    s
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean)
  function submit(e: FormEvent<HTMLFormElement>, work: (v: (k: string) => string) => Promise<void>) {
    e.preventDefault()
    const form = e.currentTarget,
      entries = new FormData(form)
    void perform(async () => {
      await work((k) => String(entries.get(k) ?? ''))
      form.reset()
    })
  }
  return (
    <>
      <div className="page-intro">
        <h1>{t('settings')}</h1>
      </div>
      <div className="settings-stack">
        {session ? (
          <section className="panel form">
            <h2>
              <Building2 size={19} />
              {t('workspace')}
            </h2>
            <div className="field-pair">
              <label>
                {t('org')}
                <select value={org?.id ?? ''} onChange={(e) => chooseOrg(e.target.value)}>
                  {!org && <option value="">{t('select')}</option>}
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('event')}
                <select value={event?.id ?? ''} onChange={(e) => chooseEvent(e.target.value)}>
                  {!event && <option value="">{t('select')}</option>}
                  {events.map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {org && (
              <small>
                {t('membership')} · {t(org.role)}
              </small>
            )}
            <form
              onSubmit={(e) =>
                submit(e, async (v) => {
                  const o = await apiRequest<Organization>('/organizations', session.token, 'POST', {
                    name: v('name'),
                  })
                  await reload(o.id)
                })
              }
            >
              <label>
                {t('newOrg')}
                <input name="name" required maxLength={200} />
              </label>
              <Button variant="secondary" disabled={busy} type="submit">
                {t('create')}
              </Button>
            </form>
            {org && manages && (
              <form
                onSubmit={(e) =>
                  submit(e, async (v) => {
                    const ev = await apiRequest<EventDto>(
                      `/organizations/${org.id}/events`,
                      session.token,
                      'POST',
                      { name: v('name') },
                    )
                    await reload(org.id, ev.id)
                  })
                }
              >
                <label>
                  {t('newEvent')}
                  <input name="name" required maxLength={200} />
                </label>
                <Button variant="secondary" disabled={busy} type="submit">
                  {t('create')}
                </Button>
              </form>
            )}
            {event && manages && policy && (
              <form
                onSubmit={(e) =>
                  submit(e, async (v) => {
                    await apiRequest(base, session.token, 'PATCH', {
                      status: v('status'),
                      faqOnly: v('faqOnly') === 'on',
                      handoffEnabled: v('handoff') === 'on',
                    })
                    await reload(org!.id, event.id)
                  })
                }
              >
                <label>
                  {t('status')}
                  <select name="status" defaultValue={event.status}>
                    {(['draft', 'active', 'archived'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" name="faqOnly" defaultChecked={policy.faqOnly} />
                  {t('faqOnly')}
                </label>
                <label className="check">
                  <input type="checkbox" name="handoff" defaultChecked={policy.handoffEnabled} />
                  {t('handoffEnabled')}
                </label>
                <Button disabled={busy} variant="secondary" type="submit">
                  {t('apply')}
                </Button>
              </form>
            )}
          </section>
        ) : (
          <section className="panel form">
            <h2>
              <Building2 size={19} />
              {t('demo')}
            </h2>
            <p>{t('demoInfo')}</p>
            <h3>{t('signIn')}</h3>
            <p>{t('telegramHelp')}</p>
          </section>
        )}
        {session && manages && org && <Administration session={session} org={org} event={event?.id} t={t} />}
        {session && manages && client && (
          <section className="panel form">
            <h2>
              <Radio size={19} />
              {t('bots')}
            </h2>
            {!bots.length && <p>{t('emptyBots')}</p>}
            {bots.map((b) => (
              <details key={b.id + rev}>
                <summary>
                  {b.name} · @{b.username}
                </summary>
                <form
                  onSubmit={(e) =>
                    submit(e, async (v) => {
                      await apiRequest(base + '/bots/' + b.id, session.token, 'PATCH', {
                        active: v('active') === 'on',
                        groupMode: v('group'),
                        privateMode: v('private'),
                        aliases: entries(v('aliases')),
                        allowedChatIds: entries(v('groups')),
                      })
                      setRev((r) => r + 1)
                    })
                  }
                >
                  <label className="check">
                    <input type="checkbox" name="active" defaultChecked={b.active} />
                    {t('active')}
                  </label>
                  <div className="field-pair">
                    <label>
                      {t('groupMode')}
                      <select name="group" defaultValue={b.groupMode}>
                        {(['off', 'mention_only', 'mention_or_name', 'all_relevant'] as const).map((m) => (
                          <option value={m} key={m}>
                            {t(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('privateMode')}
                      <select name="private" defaultValue={b.privateMode}>
                        {(['off', 'always'] as const).map((m) => (
                          <option value={m} key={m}>
                            {t(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    {t('groups')}
                    <input name="groups" defaultValue={b.allowedChatIds.join(', ')} />
                  </label>
                  <label>
                    {t('aliases')}
                    <input name="aliases" defaultValue={b.aliases.join(', ')} />
                  </label>
                  <Button type="submit" disabled={busy} variant="secondary">
                    {t('apply')}
                  </Button>
                </form>
                <form
                  onSubmit={(e) =>
                    submit(e, async (v) => {
                      await apiRequest(base + '/bots/' + b.id + '/webhook', session.token, 'POST', {
                        webhookSecret: v('secret'),
                      })
                    })
                  }
                >
                  <label>
                    {t('secret')}
                    <input required type="password" autoComplete="off" name="secret" />
                  </label>
                  <Button disabled={busy} type="submit" variant="secondary">
                    {t('webhook')}
                  </Button>
                </form>
              </details>
            ))}
            <details>
              <summary>{t('connect')}</summary>
              <form
                onSubmit={(e) =>
                  submit(e, async (v) => {
                    await client.connect!({
                      name: v('name'),
                      token: v('token'),
                      webhookSecret: v('secret'),
                      allowedChatIds: entries(v('groups')),
                      aliases: entries(v('aliases')),
                    })
                    setRev((r) => r + 1)
                  })
                }
              >
                <label>
                  {t('botName')}
                  <input name="name" required />
                </label>
                <label>
                  {t('token')}
                  <input type="password" autoComplete="off" name="token" required />
                </label>
                <label>
                  {t('secret')}
                  <input
                    type="password"
                    autoComplete="off"
                    minLength={16}
                    maxLength={256}
                    name="secret"
                    required
                  />
                </label>
                <label>
                  {t('groups')}
                  <input name="groups" placeholder="-1001234567890" />
                </label>
                <label>
                  {t('aliases')}
                  <input name="aliases" />
                </label>
                <Button type="submit" disabled={busy}>
                  {t('connect')}
                </Button>
              </form>
            </details>
          </section>
        )}
        {session && manages && client?.saveFunding && fund && (
          <section className="panel form">
            <h2>
              <SlidersHorizontal size={19} />
              {t('funding')}
            </h2>
            <form
              key={rev}
              onSubmit={(e) =>
                submit(e, async (v) => {
                  await client.saveFunding!({
                    funding: v('funding') as Funding['funding'],
                    dailyLimitMicros: Number(v('limit')),
                    key: v('key') || undefined,
                  })
                  setRev((r) => r + 1)
                })
              }
            >
              <label>
                {t('funding')}
                <select defaultValue={fund.funding} name="funding">
                  <option value="platform">{t('platform')}</option>
                  <option value="byok">BYOK</option>
                </select>
              </label>
              <label>
                {t('dailyLimit')}
                <input
                  name="limit"
                  type="number"
                  min="0"
                  step="1"
                  required
                  defaultValue={fund.dailyLimitMicros}
                />
              </label>
              <label>
                {t('apiKey')}
                <input name="key" type="password" autoComplete="off" />
              </label>
              <Button disabled={busy} type="submit">
                {t('apply')}
              </Button>
            </form>
          </section>
        )}
        <section className="panel form">
          <h2>
            <Activity size={19} />
            {t('diagnostics')}
          </h2>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                setMessage((await getReadiness(AbortSignal.timeout(5000))).status === 'ok' ? 'ok' : 'down')
              } catch {
                setMessage('down')
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('health')}
          </Button>
        </section>
        {session && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await logout(session.token)
                location.reload()
              })
            }
          >
            {t('logout')}
          </Button>
        )}
        {error && (
          <p className="notice" role="alert">
            {t(error)}
          </p>
        )}
        {message && <p role="status">{t(message)}</p>}
      </div>
    </>
  )
}
