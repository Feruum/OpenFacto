import type { Organization } from './workspace'
import type { Screen } from './Overview'
export function canSee(key: Screen, role: Organization['role']) {
  if (key === 'knowledge') return ['owner', 'admin', 'editor'].includes(role)
  if (key === 'inbox') return ['owner', 'admin', 'moderator'].includes(role)
  if (key === 'playground') return role !== 'viewer'
  return true
}
