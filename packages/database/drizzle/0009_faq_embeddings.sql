CREATE TABLE "faq_embeddings" (
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"model_key" text NOT NULL,
	"embedding" real[],
	"claim_token" uuid,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "faq_embeddings_version_id_model_key_pk" PRIMARY KEY("version_id","model_key"),
	CONSTRAINT "faq_embeddings_dimensions" CHECK (embedding IS NULL OR cardinality(embedding) BETWEEN 8 AND 4096)
);
--> statement-breakpoint
ALTER TABLE "faq_embeddings" ADD CONSTRAINT "faq_embeddings_scoped_version_fk" FOREIGN KEY ("organization_id","event_id","source_id","version_id") REFERENCES "public"."source_versions"("organization_id","event_id","source_id","id") ON DELETE cascade ON UPDATE no action;