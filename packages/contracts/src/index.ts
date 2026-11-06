/** Public, browser-safe REST contract. No server configuration imports. */
export const API_PREFIX = '/api/v1' as const;
export const locales = ['ru', 'kk', 'en'] as const;
export type Locale = (typeof locales)[number];
export const roles = ['owner', 'admin', 'editor', 'moderator', 'viewer'] as const;
export type OrganizationRole = (typeof roles)[number];
export type UUID = string;
/** Telegram IDs are decimal strings across JSON and SQL boundaries. */
export type TelegramId = string;
export type ISODateTime = string;
export type EventStatus = 'draft' | 'active' | 'archived';
export type ErrorCode = 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'DEPENDENCY_UNAVAILABLE' | 'INTERNAL_ERROR';
export interface ApiError { code: ErrorCode; message: string; requestId: string }
export interface CursorQuery { cursor?: string; limit?: number }
export interface CursorPage<T> { items: T[]; nextCursor: string | null }
export interface UserDto { id: UUID; telegramId: TelegramId; displayName: string; locale: Locale; createdAt: ISODateTime }
export interface OrganizationDto { id: UUID; name: string; createdAt: ISODateTime }
export interface MembershipDto { id: UUID; organizationId: UUID; userId: UUID; role: OrganizationRole; createdAt: ISODateTime }
export interface EventDto { id: UUID; organizationId: UUID; name: string; status: EventStatus; createdAt: ISODateTime; updatedAt: ISODateTime }
/** Business DTOs are planned contracts; the endpoints do not exist at stage 0. */
export interface CreateOrganizationDto { name: string }
export interface CreateEventDto { name: string }
export interface TelegramAuthDto { initData: string }
export interface LiveResponse { status: 'ok' }
export interface ReadyResponse {
  status: 'ok' | 'unavailable';
  dependencies: { postgres: 'up' | 'down'; redis: 'up' | 'down' };
}
export function isReadyResponse(value: unknown): value is ReadyResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReadyResponse>;
  const dependencies = candidate.dependencies;
  if (!dependencies || !['up', 'down'].includes(dependencies.postgres) || !['up', 'down'].includes(dependencies.redis)) return false;
  return candidate.status === (dependencies.postgres === 'up' && dependencies.redis === 'up' ? 'ok' : 'unavailable');
}
