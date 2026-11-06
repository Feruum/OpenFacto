CREATE TYPE "public"."locale" AS ENUM('ru', 'kk', 'en');
--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'editor', 'moderator', 'viewer');
--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'active', 'archived');
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_id" text NOT NULL,
  "display_name" text NOT NULL,
  "locale" "locale" DEFAULT 'ru' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_telegram_id_decimal" CHECK ("telegram_id" ~ '^[1-9][0-9]*$')
);
--> statement-breakpoint
CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_name_nonempty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL CONSTRAINT "memberships_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL CONSTRAINT "memberships_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "role" "organization_role" DEFAULT 'viewer' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL CONSTRAINT "events_organization_id_organizations_id_fk" REFERENCES "organizations"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "status" "event_status" DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "events_name_nonempty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_unique" ON "users" USING btree ("telegram_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_user_unique" ON "memberships" USING btree ("organization_id", "user_id");
--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "events_organization_id_id_idx" ON "events" USING btree ("organization_id", "id");
