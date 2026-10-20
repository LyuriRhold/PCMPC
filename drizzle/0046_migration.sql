CREATE TABLE "water_consumption_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"consumption" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_consumption_history_uq" UNIQUE("account_id","period"),
	CONSTRAINT "water_consumption_history_chk" CHECK ("water_consumption_history"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "water_consumption_history"."consumption" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"content" "bytea" NOT NULL,
	"cutoff_date" date NOT NULL,
	"status" text DEFAULT 'UPLOADED' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"staged_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"je_id" uuid,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "import_batches_entity_chk" CHECK (entity IN ('members', 'share_capital', 'savings', 'time_deposits', 'loans', 'water_accounts', 'water_bills', 'store_stock', 'suppliers', 'store_ar', 'trial_balance')),
	CONSTRAINT "import_batches_status_chk" CHECK (status IN ('UPLOADED', 'VALIDATED', 'STAGED', 'POSTED', 'ROLLED_BACK')),
	CONSTRAINT "import_batches_counts_chk" CHECK ("import_batches"."row_count" >= 0 AND "import_batches"."error_count" >= 0),
	CONSTRAINT "import_batches_posted_chk" CHECK (("import_batches"."status" = 'POSTED') = ("import_batches"."je_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"column" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"loan_no" text,
	"product_code" text NOT NULL,
	"principal" bigint NOT NULL,
	"term" integer NOT NULL,
	"rate_pm" text NOT NULL,
	"release_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"installments_paid" integer NOT NULL,
	"outstanding_principal" bigint NOT NULL,
	"unpaid_penalty" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"suffix" text,
	"birthdate" date NOT NULL,
	"sex" text NOT NULL,
	"civil_status" text NOT NULL,
	"addr_street" text,
	"addr_purok" text,
	"addr_barangay" text NOT NULL,
	"addr_municipality" text NOT NULL,
	"addr_province" text NOT NULL,
	"mobile" text,
	"email" text,
	"occupation" text,
	"tin" text,
	"membership_date" date NOT NULL,
	"pmes_date" date,
	"bod_resolution_no" text,
	"membership_fee" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_savings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"account_no" text,
	"product_code" text NOT NULL,
	"opened_on" date NOT NULL,
	"balance" bigint NOT NULL,
	"last_txn_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_share_capital" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"subscribed" bigint NOT NULL,
	"paid_up" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_store_ar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"balance" bigint NOT NULL,
	"charge_limit" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_store_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"category" text,
	"selling_price" bigint NOT NULL,
	"unit_cost" text NOT NULL,
	"quantity" integer NOT NULL,
	"reorder_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"tin" text,
	"terms_days" integer NOT NULL,
	"balance" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_time_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"member_no" text NOT NULL,
	"certificate_no" text,
	"principal" bigint NOT NULL,
	"rate_pa" text NOT NULL,
	"term_days" integer NOT NULL,
	"placement_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"savings_account_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_trial_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"account_code" text NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint NOT NULL,
	"credit" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stg_trial_balance_side_chk" CHECK ("stg_trial_balance"."debit" >= 0 AND "stg_trial_balance"."credit" >= 0 AND ("stg_trial_balance"."debit" = 0 OR "stg_trial_balance"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "stg_water_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"account_no" text NOT NULL,
	"customer_no" text,
	"member_no" text,
	"last_name" text,
	"first_name" text,
	"middle_name" text,
	"business_name" text,
	"customer_address" text NOT NULL,
	"mobile" text,
	"classification" text NOT NULL,
	"zone_code" text NOT NULL,
	"route_code" text NOT NULL,
	"sequence_no" integer,
	"service_address" text NOT NULL,
	"status" text NOT NULL,
	"connected_on" date NOT NULL,
	"meter_serial" text NOT NULL,
	"meter_digits" integer NOT NULL,
	"last_reading" integer NOT NULL,
	"consumption_1" integer,
	"consumption_2" integer,
	"consumption_3" integer,
	"deposit" bigint NOT NULL,
	"advance" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stg_water_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"account_no" text NOT NULL,
	"bill_no" text,
	"period" text NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"consumption" integer,
	"amount" bigint NOT NULL,
	"penalty_assessed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "deposit_transactions" DROP CONSTRAINT "deposit_transactions_type_chk";--> statement-breakpoint
ALTER TABLE "deposit_transactions" DROP CONSTRAINT "deposit_transactions_sign_chk";--> statement-breakpoint
ALTER TABLE "loans" DROP CONSTRAINT "loans_disbursement_chk";--> statement-breakpoint
ALTER TABLE "water_bills" ALTER COLUMN "reading_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_fees" ALTER COLUMN "receipt_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "water_bills" ADD COLUMN "migrated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "water_bills" ADD COLUMN "penalty_assessed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "water_consumption_history" ADD CONSTRAINT "water_consumption_history_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_rolled_back_by_users_id_fk" FOREIGN KEY ("rolled_back_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_loans" ADD CONSTRAINT "stg_loans_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_members" ADD CONSTRAINT "stg_members_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_savings" ADD CONSTRAINT "stg_savings_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_share_capital" ADD CONSTRAINT "stg_share_capital_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_store_ar" ADD CONSTRAINT "stg_store_ar_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_store_stock" ADD CONSTRAINT "stg_store_stock_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_suppliers" ADD CONSTRAINT "stg_suppliers_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_time_deposits" ADD CONSTRAINT "stg_time_deposits_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_trial_balance" ADD CONSTRAINT "stg_trial_balance_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_trial_balance" ADD CONSTRAINT "stg_trial_balance_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_water_accounts" ADD CONSTRAINT "stg_water_accounts_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_water_bills" ADD CONSTRAINT "stg_water_bills_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_hash_uq" ON "import_batches" USING btree ("file_hash") WHERE status <> 'ROLLED_BACK';--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_open_entity_uq" ON "import_batches" USING btree ("entity") WHERE status IN ('UPLOADED', 'VALIDATED', 'STAGED');--> statement-breakpoint
CREATE INDEX "import_batches_cutoff_idx" ON "import_batches" USING btree ("cutoff_date");--> statement-breakpoint
CREATE INDEX "import_errors_batch_idx" ON "import_errors" USING btree ("batch_id","row");--> statement-breakpoint
CREATE INDEX "stg_loans_batch_idx" ON "stg_loans" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_members_batch_idx" ON "stg_members" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_savings_batch_idx" ON "stg_savings" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_share_capital_batch_idx" ON "stg_share_capital" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_store_ar_batch_idx" ON "stg_store_ar" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_store_stock_batch_idx" ON "stg_store_stock" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_suppliers_batch_idx" ON "stg_suppliers" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_time_deposits_batch_idx" ON "stg_time_deposits" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_trial_balance_batch_idx" ON "stg_trial_balance" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_water_accounts_batch_idx" ON "stg_water_accounts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stg_water_bills_batch_idx" ON "stg_water_bills" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "water_bills" ADD CONSTRAINT "water_bills_reading_chk" CHECK ("water_bills"."reading_id" IS NOT NULL OR "water_bills"."migrated");--> statement-breakpoint
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_type_chk" CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'WTAX', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING'));--> statement-breakpoint
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_sign_chk" CHECK ("deposit_transactions"."amount" <> 0 AND ("deposit_transactions"."type" = 'ADJUSTMENT' OR ("deposit_transactions"."type" IN ('DEPOSIT', 'INTEREST', 'TRANSFER_IN', 'OPENING') AND "deposit_transactions"."amount" > 0) OR ("deposit_transactions"."type" IN ('WITHDRAWAL', 'WTAX', 'TRANSFER_OUT') AND "deposit_transactions"."amount" < 0)));--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_disbursement_chk" CHECK (disbursement IN ('CASH', 'SAVINGS', 'RESTRUCTURE', 'MIGRATION'));