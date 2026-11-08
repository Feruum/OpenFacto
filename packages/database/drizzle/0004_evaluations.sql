CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"config" jsonb NOT NULL,
	"cases" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "evaluation_runs_status" CHECK (status IN ('pending','running','completed','failed'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_runs_available" ON "evaluation_runs" USING btree ("status","available_at");