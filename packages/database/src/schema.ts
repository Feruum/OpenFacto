import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const locale = pgEnum('locale', ['ru', 'kk', 'en']);
export const organizationRole = pgEnum('organization_role', ['owner', 'admin', 'editor', 'moderator', 'viewer']);
export const eventStatus = pgEnum('event_status', ['draft', 'active', 'archived']);
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: text('telegram_id').notNull(),
  displayName: text('display_name').notNull(),
  locale: locale('locale').notNull().default('ru'),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('users_telegram_id_unique').on(table.telegramId), check('users_telegram_id_decimal', sql`${table.telegramId} ~ '^[1-9][0-9]*$'`)]);
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull(), createdAt: createdAt(),
}, (table) => [check('organizations_name_nonempty', sql`length(trim(${table.name})) > 0`)]);
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: organizationRole('role').notNull().default('viewer'), createdAt: createdAt(),
}, (table) => [uniqueIndex('memberships_organization_user_unique').on(table.organizationId, table.userId), index('memberships_user_id_idx').on(table.userId)]);
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), status: eventStatus('status').notNull().default('draft'), createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [index('events_organization_id_id_idx').on(table.organizationId, table.id), check('events_name_nonempty', sql`length(trim(${table.name})) > 0`)]);
