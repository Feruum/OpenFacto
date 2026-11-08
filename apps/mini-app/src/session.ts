import type { UserDto } from '@openfacto/contracts'
import { apiRequest, ApiFailure } from './api'
import type { Session } from './workspace'

const sessionKey = 'openfacto.tab-session'
let pending: Promise<Session | null> | undefined
export function startSession() {
  if (!pending)
    pending = authenticate().catch((e) => {
      pending = undefined
      throw e
    })
  return pending
}
async function authenticate(): Promise<Session | null> {
  const params = new URLSearchParams(location.hash.slice(1))
  const data = params.get('tgWebAppData')
  if (data) {
    sessionStorage.removeItem(sessionKey)
    const session = await apiRequest<Session>('/auth/telegram', undefined, 'POST', { initData: data })
    sessionStorage.setItem(sessionKey, session.token)
    history.replaceState(null, '', location.pathname + location.search)
    return session
  }
  const token = sessionStorage.getItem(sessionKey)
  if (!token) {
    if (import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO === '1' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
      const session = await apiRequest<Session>('/auth/local-demo', undefined, 'POST', {})
      sessionStorage.setItem(sessionKey, session.token)
      return session
    }
    return null
  }
  try {
    return { token, user: await apiRequest<UserDto>('/me', token) }
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 401) sessionStorage.removeItem(sessionKey)
    throw e
  }
}
export async function logout(token: string) {
  await apiRequest('/auth/logout', token, 'POST', {})
  sessionStorage.removeItem(sessionKey)
  pending = undefined
}
