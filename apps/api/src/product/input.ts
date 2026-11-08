import { BadRequestException, NotFoundException } from '@nestjs/common';
export type Fields = Record<string, unknown>;
export function object(value: unknown): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Fields;
}
export function string(value: unknown, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw new BadRequestException();
  return value.trim();
}
export function identifier(value: unknown) {
  const id = string(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException();
  return id.toLowerCase();
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new BadRequestException();
  return value as T;
}
export function list(value: unknown, max = 30): string[] {
  if (!Array.isArray(value) || value.length > max) throw new BadRequestException();
  return [...new Set(value.map((item) => string(item, 128)))];
}
export function boolean(value: unknown, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new BadRequestException();
  return value;
}
export function first<T>(rows: ArrayLike<T>): T {
  if (!rows.length) throw new NotFoundException();
  return rows[0]!;
}
export const languages = ['ru', 'kk', 'en'] as const;
export const visibility = ['participant', 'internal'] as const;
export const editing = ['owner', 'admin', 'editor'] as const;
export const managing = ['owner', 'admin'] as const;
export const moderating = ['owner', 'admin', 'moderator'] as const;
export type Scope = { org: string; event: string };
export function range(query: Fields, scope: string) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException();
  let after = '00000000-0000-0000-0000-000000000000';
  if (query.cursor !== undefined) {
    try {
      const [namespace, id] = JSON.parse(Buffer.from(string(query.cursor, 512), 'base64url').toString('utf8'));
      if (namespace !== scope) throw new Error();
      after = identifier(id);
    } catch {
      throw new BadRequestException();
    }
  }
  return {
    after,
    limit,
    page<T extends Record<string, unknown>>(rows: T[]) {
      const items = rows.slice(0, limit);
      return {
        items,
        nextCursor:
          rows.length > limit ? Buffer.from(JSON.stringify([scope, items.at(-1)!.id])).toString('base64url') : null,
      };
    },
  };
}
