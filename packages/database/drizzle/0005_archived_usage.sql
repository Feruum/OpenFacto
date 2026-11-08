CREATE TABLE "ai_daily_archived" (
	"day" date NOT NULL,
	"funding" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	CONSTRAINT "ai_daily_archived_day_funding_pk" PRIMARY KEY("day","funding"),
	CONSTRAINT "ai_daily_archived_nonnegative" CHECK (amount_micros >= 0)
);
--> statement-breakpoint
CREATE FUNCTION archive_ai_operation_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ai_daily_archived(day,funding,amount_micros) VALUES(OLD.day,OLD.funding,COALESCE(OLD.cost_micros,OLD.reserved_micros))
  ON CONFLICT(day,funding) DO UPDATE SET amount_micros=ai_daily_archived.amount_micros+excluded.amount_micros;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER archive_ai_charge AFTER DELETE ON ai_operations FOR EACH ROW EXECUTE FUNCTION archive_ai_operation_charge();
