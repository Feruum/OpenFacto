CREATE TABLE "queue_dispatches" (
	"queue" text NOT NULL,
	"name" text NOT NULL,
	"job_id" uuid NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	CONSTRAINT "queue_dispatches_queue_name_job_id_pk" PRIMARY KEY("queue","name","job_id")
);
--> statement-breakpoint
CREATE INDEX "queue_dispatches_expiry_idx" ON "queue_dispatches" USING btree ("available_at");