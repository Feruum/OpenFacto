ALTER TABLE telegram_bots ADD COLUMN group_mode text NOT NULL DEFAULT 'mention_or_name' CHECK(group_mode IN ('off','mention_only','mention_or_name','all_relevant')),
 ADD COLUMN private_mode text NOT NULL DEFAULT 'always' CHECK(private_mode IN ('off','always'));
--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_tenant_key UNIQUE(organization_id,id);
--> statement-breakpoint
ALTER TABLE handoffs DROP CONSTRAINT handoffs_status_check,
 ADD CONSTRAINT handoffs_status_check CHECK(status IN ('open','resolved','closed')),
 ADD COLUMN assigned_membership_id uuid,
 ADD FOREIGN KEY(organization_id,assigned_membership_id) REFERENCES memberships(organization_id,id) ON DELETE SET NULL (assigned_membership_id),
 ADD FOREIGN KEY(organization_id,event_id,faq_draft_id) REFERENCES knowledge_sources(organization_id,event_id,id) ON DELETE SET NULL (faq_draft_id);
--> statement-breakpoint
CREATE TABLE audit_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 event_id uuid,actor_id uuid NOT NULL,action text NOT NULL,resource_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX audit_records_scope ON audit_records(organization_id,event_id,id);
--> statement-breakpoint
CREATE FUNCTION record_product_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid := NULLIF(current_setting('openfacto.actor',true),'')::uuid; r jsonb;
 org uuid; event uuid; resource uuid; action_name text;
BEGIN
 IF actor IS NULL THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN r:=to_jsonb(OLD); ELSE r:=to_jsonb(NEW); END IF;
 org:=(r->>'organization_id')::uuid;
 event:=CASE WHEN TG_TABLE_NAME='events' THEN (r->>'id')::uuid ELSE (r->>'event_id')::uuid END;
 resource:=COALESCE((r->>'id')::uuid,event);
 action_name:=TG_TABLE_NAME||'.'||lower(TG_OP);
 IF TG_TABLE_NAME='knowledge_sources' AND TG_OP='UPDATE' THEN
   IF r->>'published_version_id' IS DISTINCT FROM to_jsonb(OLD)->>'published_version_id' THEN
     action_name:=CASE WHEN r->>'published_version_id' IS NULL THEN 'publication.revoke' ELSE 'publication.select' END;
   END IF;
 END IF;
 INSERT INTO audit_records(organization_id,event_id,actor_id,action,resource_id) VALUES(org,event,actor,action_name,resource);
 RETURN NULL;
END $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','memberships','knowledge_sources','source_versions','telegram_bots','handoffs','event_ai_settings']
 LOOP
  EXECUTE format('CREATE TRIGGER product_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_product_mutation()',t);
 END LOOP;
END $$;
