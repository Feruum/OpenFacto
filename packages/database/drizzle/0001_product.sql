ALTER TABLE events ADD CONSTRAINT events_tenant_key UNIQUE (organization_id,id);
--> statement-breakpoint
ALTER TABLE events ADD COLUMN faq_only boolean NOT NULL DEFAULT false, ADD COLUMN handoff_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 init_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE knowledge_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('faq','document')), title text NOT NULL, body text NOT NULL,
 language locale NOT NULL DEFAULT 'ru', aliases text[] NOT NULL DEFAULT '{}',
 visibility text NOT NULL DEFAULT 'participant' CHECK(visibility IN ('participant','internal')),
 published_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE,
 UNIQUE(organization_id,event_id,id)
);
--> statement-breakpoint
CREATE TABLE source_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL, source_id uuid NOT NULL,
 number integer NOT NULL, title text NOT NULL, body text NOT NULL, language locale NOT NULL, aliases text[] NOT NULL,
 visibility text NOT NULL CHECK(visibility IN ('participant','internal')),
 ingestion_status text NOT NULL DEFAULT 'none' CHECK(ingestion_status IN ('none','uploading','pending','processing','ready','failed')),
 original_sha256 text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,event_id,source_id) REFERENCES knowledge_sources(organization_id,event_id,id) ON DELETE CASCADE,
 UNIQUE(organization_id,event_id,source_id,id), UNIQUE(source_id,number)
);
--> statement-breakpoint
ALTER TABLE knowledge_sources ADD CONSTRAINT source_publication_fk FOREIGN KEY(organization_id,event_id,id,published_version_id)
 REFERENCES source_versions(organization_id,event_id,source_id,id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE telegram_bots (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, event_id uuid NOT NULL, name text NOT NULL,
 telegram_bot_id text NOT NULL UNIQUE, username text NOT NULL, token_ciphertext text NOT NULL, webhook_secret_hash text NOT NULL,
 allowed_chat_ids text[] NOT NULL DEFAULT '{}', aliases text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,event_id,id),
 FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE telegram_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL, bot_id uuid NOT NULL,
 update_id text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','failed')),
 attempts int NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bot_id,update_id), FOREIGN KEY(organization_id,event_id,bot_id) REFERENCES telegram_bots(organization_id,event_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX telegram_inbox_pending ON telegram_inbox(available_at,id) WHERE status='pending';
--> statement-breakpoint
CREATE TABLE telegram_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL, bot_id uuid NOT NULL,
 chat_id text NOT NULL, body text NOT NULL, dedupe_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
 attempts int NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bot_id,dedupe_key), FOREIGN KEY(organization_id,event_id,bot_id) REFERENCES telegram_bots(organization_id,event_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX telegram_outbox_pending ON telegram_outbox(available_at,id) WHERE status='pending';
--> statement-breakpoint
CREATE TABLE handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL, bot_id uuid, chat_id text,
 question text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), reply text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,event_id,bot_id) REFERENCES telegram_bots(organization_id,event_id,id) ON DELETE CASCADE,
 CHECK ((chat_id IS NULL)=(bot_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE answer_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL, mode text NOT NULL, outcome text NOT NULL, decision jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX answer_runs_scope ON answer_runs(organization_id,event_id,mode);
--> statement-breakpoint
CREATE INDEX handoffs_scope ON handoffs(organization_id,event_id,status,id);
--> statement-breakpoint
ALTER TABLE telegram_outbox ADD COLUMN thread_id text, ADD COLUMN source_refs jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE handoffs ADD COLUMN thread_id text;
--> statement-breakpoint
CREATE TABLE event_ai_settings (
 organization_id uuid NOT NULL,event_id uuid NOT NULL,funding text NOT NULL DEFAULT 'platform' CHECK(funding IN ('platform','byok')),
 key_ciphertext text,daily_limit_micros bigint NOT NULL DEFAULT 0 CHECK(daily_limit_micros>=0),
 PRIMARY KEY(organization_id,event_id), FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE ai_operations (
 id text PRIMARY KEY,organization_id uuid NOT NULL,event_id uuid NOT NULL,day date NOT NULL,funding text NOT NULL,
 status text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>=0),cost_micros bigint,result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(organization_id,event_id) REFERENCES events(organization_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX ai_operations_day ON ai_operations(organization_id,event_id,day,funding);
--> statement-breakpoint
CREATE TABLE clarification_context (
 organization_id uuid NOT NULL,event_id uuid NOT NULL,bot_id uuid NOT NULL,chat_id text NOT NULL,thread_id text NOT NULL,
 user_id text NOT NULL,question text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(bot_id,chat_id,thread_id,user_id),
 FOREIGN KEY(organization_id,event_id,bot_id) REFERENCES telegram_bots(organization_id,event_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE handoffs ADD COLUMN faq_draft_id uuid;
