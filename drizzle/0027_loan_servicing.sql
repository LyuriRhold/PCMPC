CREATE TABLE "loan_aging_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" date NOT NULL,
	"loan_id" uuid NOT NULL,
	"days_past_due" integer NOT NULL,
	"bucket" text NOT NULL,
	"outstanding_principal" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "loan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "loan_payments_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"loan_id" uuid NOT NULL,
	"pay_date" date NOT NULL,
	"kind" text DEFAULT 'PAYMENT' NOT NULL,
	"amount" bigint NOT NULL,
	"penalty_part" bigint NOT NULL,
	"interest_part" bigint NOT NULL,
	"principal_part" bigint NOT NULL,
	"allocations" jsonb NOT NULL,
	"ref_no" text,
	"bir_receipt_no" text,
	"receipt_item_id" uuid,
	"je_id" uuid NOT NULL,
	"reversed_by" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_payments_kind_chk" CHECK (kind IN ('PAYMENT', 'OFFSET', 'RECOVERY')),
	CONSTRAINT "loan_payments_amounts_chk" CHECK ("loan_payments"."amount" > 0 AND "loan_payments"."penalty_part" >= 0 AND "loan_payments"."interest_part" >= 0 AND "loan_payments"."principal_part" >= 0 AND ("loan_payments"."kind" = 'RECOVERY' OR "loan_payments"."amount" = "loan_payments"."penalty_part" + "loan_payments"."interest_part" + "loan_payments"."principal_part"))
);
--> statement-breakpoint
CREATE TABLE "loan_penalty_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"schedule_no" integer NOT NULL,
	"business_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"basis" bigint NOT NULL,
	"days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_penalty_accruals_chk" CHECK ("loan_penalty_accruals"."amount" >= 0 AND "loan_penalty_accruals"."basis" >= 0 AND "loan_penalty_accruals"."days" > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal_due" bigint NOT NULL,
	"interest_due" bigint NOT NULL,
	"principal_paid" bigint DEFAULT 0 NOT NULL,
	"interest_paid" bigint DEFAULT 0 NOT NULL,
	"penalty_accrued" bigint DEFAULT 0 NOT NULL,
	"penalty_paid" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_schedule_status_chk" CHECK (status IN ('OPEN', 'PARTIAL', 'PAID')),
	CONSTRAINT "loan_schedule_amounts_chk" CHECK ("loan_schedule"."principal_due" >= 0 AND "loan_schedule"."interest_due" >= 0 AND "loan_schedule"."principal_paid" BETWEEN 0 AND "loan_schedule"."principal_due" AND "loan_schedule"."interest_paid" BETWEEN 0 AND "loan_schedule"."interest_due" AND "loan_schedule"."penalty_paid" BETWEEN 0 AND "loan_schedule"."penalty_accrued")
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_no" text NOT NULL,
	"application_id" uuid,
	"member_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"principal" bigint NOT NULL,
	"rate_pm" text NOT NULL,
	"method" text NOT NULL,
	"term" integer NOT NULL,
	"release_date" date,
	"first_due_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"disbursement" text NOT NULL,
	"savings_account_id" uuid,
	"deductions" jsonb NOT NULL,
	"net_proceeds" bigint NOT NULL,
	"receivable_gl_key" text NOT NULL,
	"penalty_rate_pm" text NOT NULL,
	"grace_days" integer NOT NULL,
	"authorized_by" uuid NOT NULL,
	"released_by" uuid,
	"je_id" uuid,
	"restructured_from_id" uuid,
	"write_off_ref" text,
	"write_off_je_id" uuid,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loans_loan_no_unique" UNIQUE("loan_no"),
	CONSTRAINT "loans_status_chk" CHECK (status IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'PAID', 'RESTRUCTURED', 'WRITTEN_OFF')),
	CONSTRAINT "loans_disbursement_chk" CHECK (disbursement IN ('CASH', 'SAVINGS')),
	CONSTRAINT "loans_amounts_chk" CHECK ("loans"."principal" > 0 AND "loans"."term" > 0 AND "loans"."net_proceeds" >= 0),
	CONSTRAINT "loans_released_chk" CHECK (("loans"."status" = 'PENDING') = ("loans"."je_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "loan_aging_snapshots" ADD CONSTRAINT "loan_aging_snapshots_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_reversed_by_journal_entries_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_penalty_accruals" ADD CONSTRAINT "loan_penalty_accruals_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schedule" ADD CONSTRAINT "loan_schedule_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_product_id_loan_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."loan_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_write_off_je_id_journal_entries_id_fk" FOREIGN KEY ("write_off_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_aging_snapshots_uq" ON "loan_aging_snapshots" USING btree ("as_of","loan_id");--> statement-breakpoint
CREATE INDEX "loan_payments_loan_idx" ON "loan_payments" USING btree ("loan_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_penalty_accruals_uq" ON "loan_penalty_accruals" USING btree ("loan_id","schedule_no","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_schedule_loan_no_uq" ON "loan_schedule" USING btree ("loan_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_application_uq" ON "loans" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "loans_member_idx" ON "loans" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "loans_status_idx" ON "loans" USING btree ("status");