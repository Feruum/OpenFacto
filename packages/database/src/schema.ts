import {
  pgTable,
  foreignKey,
  unique,
  check,
  uuid,
  integer,
  real,
  text,
  timestamp,
  uniqueIndex,
  index,
  boolean,
  type PgTableExtraConfigValue,
  jsonb,
  date,
  bigint,
  primaryKey,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const eventStatus = pgEnum('event_status', ['draft', 'active', 'archived']);

export const queueDispatches = pgTable('queue_dispatches', {
  queue: text().notNull(),
  name: text().notNull(),
  jobId: uuid('job_id').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
}, table => [primaryKey({columns:[table.queue,table.name,table.jobId]}),
  index('queue_dispatches_expiry_idx').on(table.availableAt)]);

export const playgroundRequests = pgTable(
  'playground_requests',
  {
    id: uuid().primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: text().notNull(),
    traceId: uuid('trace_id').notNull().unique(),
    mode: text().notNull().default('published_preview'),
    input: jsonb(),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    errorCode: text('error_code'),
  },
  (table) => [
    check('playground_requests_status_check', sql`${table.status} IN ('pending','running','completed','failed')`),
    check('playground_requests_attempts_check', sql`${table.attempts} >= 0`),
    index('playground_requests_work_idx').on(table.status, table.availableAt),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'playground_requests_event_fk',
    }).onDelete('cascade'),
  ],
);

export const faqEmbeddings = pgTable(
  'faq_embeddings',
  {
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    versionId: uuid('version_id').notNull(),
    modelKey: text('model_key').notNull(),
    embedding: real().array(),
    claimToken: uuid('claim_token'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.modelKey] }),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.sourceId, table.versionId],
      foreignColumns: [
        sourceVersions.organizationId,
        sourceVersions.eventId,
        sourceVersions.sourceId,
        sourceVersions.id,
      ],
      name: 'faq_embeddings_scoped_version_fk',
    }).onDelete('cascade'),
    check('faq_embeddings_dimensions', sql`embedding IS NULL OR cardinality(embedding) BETWEEN 8 AND 4096`),
  ],
);

export const aiDailyArchived = pgTable(
  'ai_daily_archived',
  {
    day: date().notNull(),
    funding: text().notNull(),
    amountMicros: bigint('amount_micros', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.funding] }),
    check('ai_daily_archived_nonnegative', sql`amount_micros >= 0`),
  ],
);

export const evaluationRuns = pgTable(
  'evaluation_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    status: text().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    config: jsonb().notNull(),
    cases: jsonb().notNull(),
    results: jsonb().notNull().default([]),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'evaluation_runs_event_fk',
    }).onDelete('cascade'),
    index('evaluation_runs_available').on(table.status, table.availableAt),
    check('evaluation_runs_status', sql`status IN ('pending','running','completed','failed')`),
  ],
);
export const locale = pgEnum('locale', ['ru', 'kk', 'en']);
export const organizationRole = pgEnum('organization_role', ['owner', 'admin', 'editor', 'moderator', 'viewer']);

export const sourceChunks = pgTable(
  'source_chunks',
  {
    id: uuid().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    versionId: uuid('version_id').notNull(),
    ordinal: integer().notNull(),
    page: integer().notNull(),
    body: text().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.organizationId, table.eventId, table.sourceId, table.versionId],
      foreignColumns: [
        sourceVersions.organizationId,
        sourceVersions.eventId,
        sourceVersions.sourceId,
        sourceVersions.id,
      ],
      name: 'source_chunks_organization_id_event_id_source_id_version_i_fkey',
    }).onDelete('cascade'),
    unique('source_chunks_version_id_ordinal_key').on(table.versionId, table.ordinal),
    check('source_chunks_ordinal_check', sql`ordinal >= 0`),
    check('source_chunks_page_check', sql`page > 0`),
    check('source_chunks_body_check', sql`length(body) > 0`),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (): PgTableExtraConfigValue[] => [check('organizations_name_nonempty', sql`length(TRIM(BOTH FROM name)) > 0`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: organizationRole().default('viewer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex('memberships_organization_user_unique').on(table.organizationId, table.userId),
    index('memberships_user_id_idx').on(table.userId),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: 'memberships_organization_id_organizations_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'memberships_user_id_users_id_fk',
    }).onDelete('cascade'),
    unique('memberships_tenant_key').on(table.organizationId, table.id),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    telegramId: text('telegram_id').notNull(),
    displayName: text('display_name').notNull(),
    locale: locale().default('ru').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex('users_telegram_id_unique').on(table.telegramId),
    check('users_telegram_id_decimal', sql`telegram_id ~ '^[1-9][0-9]*$'::text`),
  ],
);

export const documentPurges = pgTable('document_purges', {
  versionId: uuid('version_id').primaryKey().notNull(),
  organizationId: uuid('organization_id').notNull(),
  eventId: uuid('event_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  indexCollections: text('index_collections').array().notNull(),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const events = pgTable(
  'events',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    name: text().notNull(),
    status: eventStatus().default('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    faqOnly: boolean('faq_only').default(false).notNull(),
    handoffEnabled: boolean('handoff_enabled').default(true).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('events_organization_id_id_idx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: 'events_organization_id_organizations_id_fk',
    }).onDelete('cascade'),
    unique('events_tenant_key').on(table.organizationId, table.id),
    check('events_name_nonempty', sql`length(TRIM(BOTH FROM name)) > 0`),
  ],
);

export const sourceVersions = pgTable(
  'source_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    number: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    language: locale().notNull(),
    aliases: text().array().notNull(),
    visibility: text().notNull(),
    ingestionStatus: text('ingestion_status').default('none').notNull(),
    pageDiagnostics: jsonb('page_diagnostics').default([]).notNull(),
    originalSha256: text('original_sha256'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    ingestionAttempts: integer('ingestion_attempts').default(0).notNull(),
    ingestionAvailableAt: timestamp('ingestion_available_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    ingestionClaim: uuid('ingestion_claim'),
    indexCollections: text('index_collections').array().default([]).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('source_versions_ingestion_due')
      .on(table.ingestionAvailableAt, table.id)
      .where(sql`(ingestion_status = ANY (ARRAY['pending'::text, 'processing'::text]))`),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.sourceId],
      foreignColumns: [knowledgeSources.organizationId, knowledgeSources.eventId, knowledgeSources.id],
      name: 'source_versions_organization_id_event_id_source_id_fkey',
    }).onDelete('cascade'),
    unique('source_versions_organization_id_event_id_source_id_id_key').on(
      table.organizationId,
      table.eventId,
      table.sourceId,
      table.id,
    ),
    unique('source_versions_source_id_number_key').on(table.sourceId, table.number),
    check('source_versions_visibility_check', sql`visibility = ANY (ARRAY['participant'::text, 'internal'::text])`),
    check(
      'source_versions_ingestion_status_check',
      sql`ingestion_status = ANY (ARRAY['none'::text, 'uploading'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    initHash: text('init_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revoked: boolean().default(false).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }).onDelete('cascade'),
    unique('sessions_init_hash_key').on(table.initHash),
  ],
);

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    language: locale().default('ru').notNull(),
    aliases: text().array().default([]).notNull(),
    visibility: text().default('participant').notNull(),
    publishedVersionId: uuid('published_version_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'knowledge_sources_organization_id_event_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.id, table.publishedVersionId],
      foreignColumns: [
        sourceVersions.organizationId,
        sourceVersions.eventId,
        sourceVersions.sourceId,
        sourceVersions.id,
      ],
      name: 'source_publication_fk',
    }),
    unique('knowledge_sources_organization_id_event_id_id_key').on(table.organizationId, table.eventId, table.id),
    check('knowledge_sources_kind_check', sql`kind = ANY (ARRAY['faq'::text, 'document'::text])`),
    check('knowledge_sources_visibility_check', sql`visibility = ANY (ARRAY['participant'::text, 'internal'::text])`),
  ],
);

export const telegramInbox = pgTable(
  'telegram_inbox',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    botId: uuid('bot_id').notNull(),
    updateId: text('update_id').notNull(),
    rateAdmitted: boolean('rate_admitted'),
    payload: jsonb().notNull(),
    status: text().default('pending').notNull(),
    attempts: integer().default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('telegram_inbox_pending')
      .on(table.availableAt, table.id)
      .where(sql`(status = 'pending'::text)`),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.botId],
      foreignColumns: [telegramBots.organizationId, telegramBots.eventId, telegramBots.id],
      name: 'telegram_inbox_organization_id_event_id_bot_id_fkey',
    }).onDelete('cascade'),
    unique('telegram_inbox_bot_id_update_id_key').on(table.botId, table.updateId),
    check('telegram_inbox_status_check', sql`status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text])`),
  ],
);

export const answerRuns = pgTable(
  'answer_runs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    mode: text().notNull(),
    outcome: text().notNull(),
    decision: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('answer_runs_scope').on(table.organizationId, table.eventId, table.mode),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'answer_runs_organization_id_event_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const telegramOutbox = pgTable(
  'telegram_outbox',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    botId: uuid('bot_id').notNull(),
    chatId: text('chat_id').notNull(),
    body: text().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text().default('pending').notNull(),
    attempts: integer().default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    threadId: text('thread_id'),
    sourceRefs: jsonb('source_refs').default([]).notNull(),
    predecessorId: uuid('predecessor_id'),
  },
  (table): PgTableExtraConfigValue[] => [
    index('telegram_outbox_pending')
      .on(table.availableAt, table.id)
      .where(sql`(status = 'pending'::text)`),
    index('telegram_outbox_predecessor').on(table.predecessorId),
    unique('telegram_outbox_chat_row').on(table.botId, table.chatId, table.id),
    foreignKey({
      columns: [table.botId, table.chatId, table.predecessorId],
      foreignColumns: [table.botId, table.chatId, table.id],
      name: 'telegram_outbox_predecessor_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.botId],
      foreignColumns: [telegramBots.organizationId, telegramBots.eventId, telegramBots.id],
      name: 'telegram_outbox_organization_id_event_id_bot_id_fkey',
    }).onDelete('cascade'),
    unique('telegram_outbox_bot_id_dedupe_key_key').on(table.botId, table.dedupeKey),
    check(
      'telegram_outbox_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'uncertain'::text])`,
    ),
  ],
);

export const telegramChatUsage = pgTable(
  'telegram_chat_usage',
  {
    botId: uuid('bot_id')
      .notNull()
      .references(() => telegramBots.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    day: date().notNull(),
    requests: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.botId, table.chatId, table.day] }),
    check('telegram_chat_usage_positive', sql`requests > 0`),
  ],
);

export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    botId: uuid('bot_id'),
    chatId: text('chat_id'),
    question: text().notNull(),
    status: text().default('open').notNull(),
    reply: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    threadId: text('thread_id'),
    faqDraftId: uuid('faq_draft_id'),
    assignedMembershipId: uuid('assigned_membership_id'),
  },
  (table): PgTableExtraConfigValue[] => [
    index('handoffs_scope').on(table.organizationId, table.eventId, table.status, table.id),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'handoffs_organization_id_event_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.botId],
      foreignColumns: [telegramBots.organizationId, telegramBots.eventId, telegramBots.id],
      name: 'handoffs_organization_id_event_id_bot_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.assignedMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'handoffs_organization_id_assigned_membership_id_fkey',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.eventId, table.faqDraftId],
      foreignColumns: [knowledgeSources.organizationId, knowledgeSources.eventId, knowledgeSources.id],
      name: 'handoffs_organization_id_event_id_faq_draft_id_fkey',
    }).onDelete('set null'),
    check('handoffs_check', sql`(chat_id IS NULL) = (bot_id IS NULL)`),

    check('handoffs_status_check', sql`status = ANY (ARRAY['open'::text, 'resolved'::text, 'closed'::text])`),
  ],
);

export const aiOperations = pgTable(
  'ai_operations',
  {
    id: text().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    day: date().notNull(),
    funding: text().notNull(),
    status: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    costMicros: bigint('cost_micros', { mode: 'number' }),
    result: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('ai_operations_day').on(table.organizationId, table.eventId, table.day, table.funding),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'ai_operations_organization_id_event_id_fkey',
    }).onDelete('cascade'),
    check('ai_operations_reserved_micros_check', sql`reserved_micros >= 0`),
  ],
);

export const telegramBots = pgTable(
  'telegram_bots',
  {
    id: uuid().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    name: text().notNull(),
    telegramBotId: text('telegram_bot_id').notNull(),
    username: text().notNull(),
    tokenCiphertext: text('token_ciphertext').notNull(),
    webhookSecretHash: text('webhook_secret_hash').notNull(),
    allowedChatIds: text('allowed_chat_ids').array().default([]).notNull(),
    aliases: text().array().default([]).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    groupMode: text('group_mode').default('mention_or_name').notNull(),
    privateMode: text('private_mode').default('always').notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'telegram_bots_organization_id_event_id_fkey',
    }).onDelete('cascade'),
    unique('telegram_bots_telegram_bot_id_key').on(table.telegramBotId),
    unique('telegram_bots_organization_id_event_id_id_key').on(table.organizationId, table.eventId, table.id),

    check(
      'telegram_bots_group_mode_check',
      sql`group_mode = ANY (ARRAY['off'::text, 'mention_only'::text, 'mention_or_name'::text, 'all_relevant'::text])`,
    ),
    check('telegram_bots_private_mode_check', sql`private_mode = ANY (ARRAY['off'::text, 'always'::text])`),
  ],
);

export const auditRecords = pgTable(
  'audit_records',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id'),
    actorId: uuid('actor_id').notNull(),
    action: text().notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('audit_records_scope').on(table.organizationId, table.eventId, table.id),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: 'audit_records_organization_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const eventAiSettings = pgTable(
  'event_ai_settings',
  {
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    funding: text().default('platform').notNull(),
    keyCiphertext: text('key_ciphertext'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    dailyLimitMicros: bigint('daily_limit_micros', { mode: 'number' }).default(0).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'event_ai_settings_organization_id_event_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.organizationId, table.eventId], name: 'event_ai_settings_pkey' }),
    check('event_ai_settings_funding_check', sql`funding = ANY (ARRAY['platform'::text, 'byok'::text])`),
    check('event_ai_settings_daily_limit_micros_check', sql`daily_limit_micros >= 0`),
  ],
);

export const clarificationContext = pgTable(
  'clarification_context',
  {
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    botId: uuid('bot_id').notNull(),
    chatId: text('chat_id').notNull(),
    threadId: text('thread_id').notNull(),
    userId: text('user_id').notNull(),
    question: text().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [table.organizationId, table.eventId, table.botId],
      foreignColumns: [telegramBots.organizationId, telegramBots.eventId, telegramBots.id],
      name: 'clarification_context_organization_id_event_id_bot_id_fkey',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.botId, table.chatId, table.threadId, table.userId],
      name: 'clarification_context_pkey',
    }),
  ],
);
