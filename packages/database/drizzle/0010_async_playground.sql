ALTER TABLE "playground_requests" ADD COLUMN "mode" text DEFAULT 'published_preview' NOT NULL;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD COLUMN "error_code" text;--> statement-breakpoint
CREATE INDEX "playground_requests_work_idx" ON "playground_requests" USING btree ("status","available_at");--> statement-breakpoint
ALTER TABLE "playground_requests" ADD CONSTRAINT "playground_requests_status_check" CHECK ("playground_requests"."status" IN ('pending','running','completed','failed'));--> statement-breakpoint
ALTER TABLE "playground_requests" ADD CONSTRAINT "playground_requests_attempts_check" CHECK ("playground_requests"."attempts" >= 0);
--> statement-breakpoint
UPDATE playground_requests r SET status='completed',mode=a.mode::text
FROM answer_runs a WHERE (a.organization_id,a.event_id,a.id)=(r.organization_id,r.event_id,r.trace_id);
--> statement-breakpoint
UPDATE playground_requests SET status='failed',error_code='legacy_request' WHERE status='pending' AND input IS NULL;
