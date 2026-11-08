import { useEffect, useState, type FormEvent } from 'react'
import { History, Users } from './icons'
import { roles, type OrganizationRole } from '@openfacto/contracts'
import { Button } from './components/arc/button/button'
import { apiRequest, errorWord } from './api'
import { pages, type Session, type Organization } from './workspace'
import type { Translate, Word } from './i18n'

type Member = { id: string; displayName: string; role: OrganizationRole; userId: string }
type Audit = { id: string; action: string; resourceId: string; createdAt: string }
export function Administration({
  session,
  org,
  event,
  t,
}: {
  session: Session
  org: Organization
  event?: string
  t: Translate
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [version, setVersion] = useState(0)
  const [section, setSection] = useState<'team' | 'audit' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Word | null>(null),
    [remove, setRemove] = useState('')
  const base = '/organizations/' + org.id + '/memberships',
    auditPath = '/organizations/' + org.id + '/events/' + event + '/audit'
  const choices: readonly OrganizationRole[] =
    org.role === 'owner' ? roles : roles.filter((r) => r !== 'owner' && r !== 'admin')
  useEffect(() => {
    let active = true
    if (section === 'team')
      pages<Member>(base, session.token)
        .then((data) => {
          if (active) setMembers(data)
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    if (section === 'audit' && event)
      pages<Audit>(auditPath, session.token)
        .then((data) => {
          if (active) setAudit(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        })
        .catch((e) => {
          if (active) setError(errorWord(e))
        })
    return () => {
      active = false
    }
  }, [base, auditPath, session, event, section, version])
  async function edit(method: string, id: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await apiRequest(base + id, session.token, method, body)
      setVersion((x) => x + 1)
      setRemove('')
    } catch (e) {
      setError(errorWord(e))
    } finally {
      setBusy(false)
    }
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    void edit('POST', '', { role: data.get('role'), telegramId: data.get('id') })
  }
  function toggle(next: 'team' | 'audit') {
    setSection((s) => (s === next ? null : next))
    setError(null)
  }
  return (
    <section className="panel form">
      <div className="actions">
        <Button variant="secondary" aria-expanded={section === 'team'} onClick={() => toggle('team')}>
          <Users size={16} />
          {t('team')}
        </Button>
        {event && (
          <Button variant="secondary" aria-expanded={section === 'audit'} onClick={() => toggle('audit')}>
            <History size={16} />
            {t('audit')}
          </Button>
        )}
      </div>
      {section === 'team' && (
        <>
          <form onSubmit={add}>
            <h3>{t('grant')}</h3>
            <label>
              {t('telegramId')}
              <input required pattern="[1-9][0-9]*" inputMode="numeric" maxLength={20} name="id" />
            </label>
            <label>
              {t('membership')}
              <select name="role" defaultValue="viewer">
                {choices.map((r) => (
                  <option key={r} value={r}>
                    {t(r)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {t('grant')}
            </Button>
          </form>
          {members.map((m) => (
            <details key={m.id}>
              <summary>
                {m.displayName} · {t(m.role)}
              </summary>
              <small>
                {t('membershipId')} · <code>{m.id}</code>
              </small>
              {m.userId !== session.user.id && choices.includes(m.role) && (
                <div className="actions">
                  <label>
                    {t('membership')}
                    <select
                      aria-label={t('membership') + ' · ' + m.displayName}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void edit('PATCH', '/' + m.id, { role: e.target.value })}
                    >
                      {choices.map((r) => (
                        <option key={r} value={r}>
                          {t(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => (remove === m.id ? void edit('DELETE', '/' + m.id) : setRemove(m.id))}
                  >
                    {t(remove === m.id ? 'confirm' : 'remove')}
                  </Button>
                </div>
              )}
            </details>
          ))}
        </>
      )}
      {section === 'audit' &&
        (!audit.length ? (
          <p>{t('emptyAudit')}</p>
        ) : (
          audit.map((a) => (
            <div key={a.id} className="audit-entry">
              <strong>{a.action}</strong>
              <small>
                {new Date(a.createdAt).toLocaleString(document.documentElement.lang)} ·{' '}
                <code>{a.resourceId}</code>
              </small>
            </div>
          ))
        ))}
      {error && (
        <p className="notice" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  )
}
