CREATE TABLE "water_bill_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"je_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_adjustments_kind_chk" CHECK (kind IN ('CREDIT', 'DEBIT')),
	CONSTRAINT "water_adjustments_status_chk" CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "water_adjustments_amount_chk" CHECK ("water_bill_adjustments"."amount" > 0),
	CONSTRAINT "water_adjustments_posted_chk" CHECK (("water_bill_adjustments"."status" = 'APPROVED') = ("water_bill_adjustments"."je_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "water_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"qty" integer,
	"rate" bigint,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_bill_lines_no_uq" UNIQUE("bill_id","line_no"),
	CONSTRAINT "water_bill_lines_kind_chk" CHECK (kind IN ('MIN_CHARGE', 'BLOCK', 'SENIOR_DISCOUNT', 'OTHER_FEE', 'ADVANCE_APPLIED', 'ADJUSTMENT'))
);
--> statement-breakpoint
CREATE TABLE "water_billing_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_exclusions_period_account_uq" UNIQUE("period_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "water_billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"zone_id" integer NOT NULL,
	"reading_from" date NOT NULL,
	"reading_to" date NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_periods_period_zone_uq" UNIQUE("period","zone_id"),
	CONSTRAINT "water_periods_status_chk" CHECK (status IN ('OPEN', 'READING', 'REVIEW', 'BILLED', 'CLOSED')),
	CONSTRAINT "water_periods_period_chk" CHECK ("water_billing_periods"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "water_periods_dates_chk" CHECK ("water_billing_periods"."reading_from" <= "water_billing_periods"."reading_to" AND "water_billing_periods"."reading_to" <= "water_billing_periods"."bill_date" AND "water_billing_periods"."bill_date" <= "water_billing_periods"."due_date")
);
--> statement-breakpoint
CREATE TABLE "water_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_no" text NOT NULL,
	"account_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"customer_type" text NOT NULL,
	"classification" text NOT NULL,
	"consumption" integer NOT NULL,
	"basic_charge" bigint NOT NULL,
	"senior_discount" bigint NOT NULL,
	"other_charges" bigint NOT NULL,
	"advance_applied" bigint NOT NULL,
	"current_amount" bigint NOT NULL,
	"previous_balance" bigint NOT NULL,
	"total_amount_due" bigint NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_bills_bill_no_unique" UNIQUE("bill_no"),
	CONSTRAINT "water_bills_period_account_uq" UNIQUE("period_id","account_id"),
	CONSTRAINT "water_bills_status_chk" CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED')),
	CONSTRAINT "water_bills_customer_type_chk" CHECK (customer_type IN ('MEMBER', 'NON_MEMBER')),
	CONSTRAINT "water_bills_amounts_chk" CHECK ("water_bills"."basic_charge" >= 0 AND "water_bills"."senior_discount" >= 0 AND "water_bills"."other_charges" >= 0 AND "water_bills"."advance_applied" >= 0 AND "water_bills"."previous_balance" >= 0 AND "water_bills"."current_amount" = "water_bills"."basic_charge" - "water_bills"."senior_discount" + "water_bills"."other_charges" AND "water_bills"."advance_applied" <= "water_bills"."current_amount" AND "water_bills"."total_amount_due" = "water_bills"."current_amount" - "water_bills"."advance_applied" + "water_bills"."previous_balance")
);
--> statement-breakpoint
CREATE TABLE "water_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"previous_reading" integer NOT NULL,
	"present_reading" integer,
	"consumption" integer NOT NULL,
	"type" text NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"reader_id" uuid,
	"read_at" timestamp with time zone NOT NULL,
	"client_uuid" uuid,
	"photo_url" text,
	"remarks" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_readings_client_uuid_unique" UNIQUE("client_uuid"),
	CONSTRAINT "water_readings_period_account_uq" UNIQUE("period_id","account_id"),
	CONSTRAINT "water_readings_type_chk" CHECK (type IN ('ACTUAL', 'ESTIMATED', 'METER_CHANGE', 'FINAL')),
	CONSTRAINT "water_readings_status_chk" CHECK (status IN ('ENTERED', 'APPROVED', 'REJECTED')),
	CONSTRAINT "water_readings_values_chk" CHECK ("water_readings"."previous_reading" >= 0 AND "water_readings"."consumption" >= 0 AND ("water_readings"."present_reading" IS NULL OR "water_readings"."present_reading" >= 0)),
	CONSTRAINT "water_readings_present_chk" CHECK (("water_readings"."type" = 'ESTIMATED') = ("water_readings"."present_reading" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"key" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"by" uuid,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "job_runs_job_key_uq" UNIQUE("job","key")
);
--> statement-breakpoint
ALTER TABLE "water_bill_adjustments" ADD CONSTRAINT "water_bill_adjustments_bill_id_water_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."water_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bill_adjustments" ADD CONSTRAINT "water_bill_adjustments_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bill_adjustments" ADD CONSTRAINT "water_bill_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bill_adjustments" ADD CONSTRAINT "water_bill_adjustments_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bill_lines" ADD CONSTRAINT "water_bill_lines_bill_id_water_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."water_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_billing_exclusions" ADD CONSTRAINT "water_billing_exclusions_period_id_water_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."water_billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_billing_exclusions" ADD CONSTRAINT "water_billing_exclusions_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_billing_exclusions" ADD CONSTRAINT "water_billing_exclusions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_billing_periods" ADD CONSTRAINT "water_billing_periods_zone_id_water_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."water_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_period_id_water_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."water_billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_reading_id_water_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."water_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_readings" ADD CONSTRAINT "water_readings_period_id_water_billing_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."water_billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_readings" ADD CONSTRAINT "water_readings_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_readings" ADD CONSTRAINT "water_readings_meter_id_water_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."water_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_readings" ADD CONSTRAINT "water_readings_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_readings" ADD CONSTRAINT "water_readings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "water_adjustments_bill_idx" ON "water_bill_adjustments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "water_bills_account_idx" ON "water_bills" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "water_readings_account_idx" ON "water_readings" USING btree ("account_id");