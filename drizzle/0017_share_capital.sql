CREATE TABLE "member_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"fee_type" text NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" date NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "member_fees_type_chk" CHECK (fee_type IN ('MEMBERSHIP')),
	CONSTRAINT "member_fees_amount_chk" CHECK ("member_fees"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "share_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"sub_date" date NOT NULL,
	"shares" integer NOT NULL,
	"par_value" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "share_subscriptions_amount_chk" CHECK ("share_subscriptions"."shares" > 0 AND "share_subscriptions"."par_value" > 0 AND "share_subscriptions"."amount" = "share_subscriptions"."shares" * "share_subscriptions"."par_value"),
	CONSTRAINT "share_subscriptions_status_chk" CHECK (status IN ('ACTIVE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "share_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"ref_no" text,
	"bir_receipt_no" text,
	"subscription_id" uuid,
	"receipt_item_id" uuid,
	"je_id" uuid NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "share_transactions_type_chk" CHECK (type IN ('SUBSCRIBE', 'PAYMENT', 'CBU_RETENTION', 'TRANSFER_IN', 'TRANSFER_OUT', 'WITHDRAWAL', 'ISC_CAPITALIZED', 'PR_CAPITALIZED', 'ADJUSTMENT')),
	CONSTRAINT "share_transactions_amount_chk" CHECK ("share_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "member_fees" ADD CONSTRAINT "member_fees_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_fees" ADD CONSTRAINT "member_fees_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_fees" ADD CONSTRAINT "member_fees_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_subscriptions" ADD CONSTRAINT "share_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_subscriptions" ADD CONSTRAINT "share_subscriptions_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_subscription_id_share_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."share_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_transactions" ADD CONSTRAINT "share_transactions_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_fees_receipt_item_uq" ON "member_fees" USING btree ("receipt_item_id");--> statement-breakpoint
CREATE INDEX "member_fees_member_idx" ON "member_fees" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "share_subscriptions_member_idx" ON "share_subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "share_transactions_member_idx" ON "share_transactions" USING btree ("member_id","txn_date");