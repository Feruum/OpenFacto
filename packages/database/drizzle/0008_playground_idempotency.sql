CREATE TABLE "playground_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "playground_requests_trace_id_unique" UNIQUE("trace_id")
);
--> statement-breakpoint
ALTER TABLE "playground_requests" ADD CONSTRAINT "playground_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_requests" ADD CONSTRAINT "playground_requests_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;