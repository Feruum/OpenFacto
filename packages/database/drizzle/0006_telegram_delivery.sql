CREATE TABLE "telegram_chat_usage" (
	"bot_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"day" date NOT NULL,
	"requests" integer NOT NULL,
	CONSTRAINT "telegram_chat_usage_bot_id_chat_id_day_pk" PRIMARY KEY("bot_id","chat_id","day"),
	CONSTRAINT "telegram_chat_usage_positive" CHECK (requests > 0)
);
--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_chat_row" UNIQUE("bot_id","chat_id","id");
--> statement-breakpoint
ALTER TABLE "telegram_inbox" ADD COLUMN "rate_admitted" boolean;
--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD COLUMN "predecessor_id" uuid;
--> statement-breakpoint
ALTER TABLE "telegram_chat_usage" ADD CONSTRAINT "telegram_chat_usage_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_predecessor_fk" FOREIGN KEY ("bot_id","chat_id","predecessor_id") REFERENCES "public"."telegram_outbox"("bot_id","chat_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "telegram_outbox_predecessor" ON "telegram_outbox" USING btree ("predecessor_id");
