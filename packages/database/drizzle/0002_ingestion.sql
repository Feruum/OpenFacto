ALTER TABLE source_versions
 ADD COLUMN ingestion_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN ingestion_available_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN ingestion_claim uuid,
 ADD COLUMN index_collections text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE INDEX source_versions_ingestion_due ON source_versions(ingestion_available_at,id)
 WHERE ingestion_status IN ('pending','processing');
--> statement-breakpoint
CREATE TABLE source_chunks (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, event_id uuid NOT NULL,
 source_id uuid NOT NULL, version_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0),
 page integer NOT NULL CHECK(page>0), body text NOT NULL CHECK(length(body)>0),
 UNIQUE(version_id,ordinal),
 FOREIGN KEY(organization_id,event_id,source_id,version_id)
 REFERENCES source_versions(organization_id,event_id,source_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE document_purges (
 version_id uuid PRIMARY KEY, organization_id uuid NOT NULL, event_id uuid NOT NULL, source_id uuid NOT NULL,
 index_collections text[] NOT NULL, available_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION enqueue_document_purge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.original_sha256 IS NOT NULL OR cardinality(OLD.index_collections)>0 THEN
  INSERT INTO document_purges(version_id,organization_id,event_id,source_id,index_collections,available_at)
  VALUES(OLD.id,OLD.organization_id,OLD.event_id,OLD.source_id,OLD.index_collections,
    CASE WHEN OLD.ingestion_status='uploading' THEN now()+interval '1 minute' ELSE now() END)
  ON CONFLICT(version_id) DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_version_purge AFTER DELETE ON source_versions
 FOR EACH ROW EXECUTE FUNCTION enqueue_document_purge();
