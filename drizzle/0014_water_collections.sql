CREATE TABLE "water_customer_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"source_receipt_item_id" uuid NOT NULL,
	"applied_bill_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_advances_amount_chk" CHECK ("water_customer_advances"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "water_deposit_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"deposit" bigint NOT NULL,
	"unpaid" bigint NOT NULL,
	"offset" bigint NOT NULL,
	"refund" bigint NOT NULL,
	"offset_je_id" uuid,
	"dv_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_deposit_settlements_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "water_settlements_amounts_chk" CHECK ("water_deposit_settlements"."offset" = LEAST("water_deposit_settlements"."deposit", "water_deposit_settlements"."unpaid") AND "water_deposit_settlements"."refund" = "water_deposit_settlements"."deposit" - "water_deposit_settlements"."offset")
);
--> statement-breakpoint
CREATE TABLE "water_disconnections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"notice_no" text NOT NULL,
	"notice_date" date NOT NULL,
	"scheduled_date" date NOT NULL,
	"notice_amount" bigint NOT NULL,
	"notice_bills" integer NOT NULL,
	"disconnected_at" date,
	"disconnect_reading" integer,
	"disconnected_by" uuid,
	"reconnected_at" date,
	"reconnect_reading" integer,
	"reconnected_by" uuid,
	"fee_receipt_item_id" uuid,
	"status" text DEFAULT 'NOTICED' NOT NULL,
	"cancel_reason" text,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_disconnections_notice_no_unique" UNIQUE("notice_no"),
	CONSTRAINT "water_disconnections_fee_receipt_item_id_unique" UNIQUE("fee_receipt_item_id"),
	CONSTRAINT "water_disconnections_status_chk" CHECK (status IN ('NOTICED', 'DISCONNECTED', 'RECONNECTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "water_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_item_id" uuid,
	"settlement_id" uuid,
	"bill_id" uuid NOT NULL,
	"penalty_part" bigint NOT NULL,
	"bill_part" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_allocations_source_chk" CHECK (("water_payment_allocations"."receipt_item_id" IS NULL) <> ("water_payment_allocations"."settlement_id" IS NULL)),
	CONSTRAINT "water_allocations_amounts_chk" CHECK ("water_payment_allocations"."penalty_part" >= 0 AND "water_payment_allocations"."bill_part" >= 0 AND "water_payment_allocations"."penalty_part" + "water_payment_allocations"."bill_part" > 0)
);
--> statement-breakpoint
CREATE TABLE "water_penalties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"assessed_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_penalties_bill_id_unique" UNIQUE("bill_id"),
	CONSTRAINT "water_penalties_amount_chk" CHECK ("water_penalties"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "water_production_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"reading_date" date NOT NULL,
	"reading" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_production_source_date_uq" UNIQUE("source","reading_date"),
	CONSTRAINT "water_production_reading_chk" CHECK ("water_production_readings"."reading" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dv_lines" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "water_customer_advances" ADD CONSTRAINT "water_customer_advances_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_customer_advances" ADD CONSTRAINT "water_customer_advances_source_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("source_receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_customer_advances" ADD CONSTRAINT "water_customer_advances_applied_bill_id_water_bills_id_fk" FOREIGN KEY ("applied_bill_id") REFERENCES "public"."water_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_deposit_settlements" ADD CONSTRAINT "water_deposit_settlements_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_deposit_settlements" ADD CONSTRAINT "water_deposit_settlements_offset_je_id_journal_entries_id_fk" FOREIGN KEY ("offset_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_deposit_settlements" ADD CONSTRAINT "water_deposit_settlements_dv_id_disbursement_vouchers_id_fk" FOREIGN KEY ("dv_id") REFERENCES "public"."disbursement_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_disconnections" ADD CONSTRAINT "water_disconnections_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_disconnections" ADD CONSTRAINT "water_disconnections_disconnected_by_users_id_fk" FOREIGN KEY ("disconnected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_disconnections" ADD CONSTRAINT "water_disconnections_reconnected_by_users_id_fk" FOREIGN KEY ("reconnected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_disconnections" ADD CONSTRAINT "water_disconnections_fee_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("fee_receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_disconnections" ADD CONSTRAINT "water_disconnections_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_payment_allocations" ADD CONSTRAINT "water_payment_allocations_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_payment_allocations" ADD CONSTRAINT "water_payment_allocations_settlement_id_water_deposit_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."water_deposit_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_payment_allocations" ADD CONSTRAINT "water_payment_allocations_bill_id_water_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."water_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_penalties" ADD CONSTRAINT "water_penalties_bill_id_water_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."water_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_penalties" ADD CONSTRAINT "water_penalties_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "water_advances_customer_idx" ON "water_customer_advances" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "water_disconnections_open_uq" ON "water_disconnections" USING btree ("account_id") WHERE "water_disconnections"."status" IN ('NOTICED', 'DISCONNECTED');--> statement-breakpoint
CREATE INDEX "water_allocations_bill_idx" ON "water_payment_allocations" USING btree ("bill_id");--> statement-breakpoint
ALTER TABLE "dv_lines" ADD CONSTRAINT "dv_lines_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;