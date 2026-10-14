CREATE TABLE "account_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"segment_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "account_segments_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "asset_classes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_life_months" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "asset_classes_life_chk" CHECK ("asset_classes"."default_life_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount" bigint NOT NULL,
	"accumulated_after" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "asset_depreciation_uq" UNIQUE("asset_id","period"),
	CONSTRAINT "asset_depreciation_amount_chk" CHECK ("asset_depreciation"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_no" text NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bank_accounts_gl_account_id_unique" UNIQUE("gl_account_id")
);
--> statement-breakpoint
CREATE TABLE "bank_recons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"book_balance" bigint NOT NULL,
	"bank_balance" bigint NOT NULL,
	"deposits_in_transit" bigint NOT NULL,
	"outstanding_checks" bigint NOT NULL,
	"adjustments" bigint NOT NULL,
	"difference" bigint NOT NULL,
	"details" jsonb,
	"saved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bank_recons_uq" UNIQUE("bank_account_id","period"),
	CONSTRAINT "bank_recons_balanced_chk" CHECK ("bank_recons"."difference" = 0 AND "bank_recons"."bank_balance" + "bank_recons"."deposits_in_transit" - "bank_recons"."outstanding_checks" = "bank_recons"."book_balance" + "bank_recons"."adjustments")
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"line_date" date NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"matched_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bank_statement_lines_matched_line_id_unique" UNIQUE("matched_line_id"),
	CONSTRAINT "bank_statement_lines_amount_chk" CHECK ("bank_statement_lines"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"ending_balance" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bank_statements_uq" UNIQUE("bank_account_id","period")
);
--> statement-breakpoint
CREATE TABLE "close_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"item" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "close_checklists_status_chk" CHECK (status IN ('PASS', 'FAIL'))
);
--> statement-breakpoint
CREATE TABLE "depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"total" bigint NOT NULL,
	"je_id" uuid,
	"ran_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "depreciation_runs_period_unique" UNIQUE("period"),
	CONSTRAINT "depreciation_runs_chk" CHECK ("depreciation_runs"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "depreciation_runs"."total" >= 0 AND (("depreciation_runs"."total" = 0) = ("depreciation_runs"."je_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"description" text NOT NULL,
	"class_code" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"cost" bigint NOT NULL,
	"salvage" bigint NOT NULL,
	"life_months" integer NOT NULL,
	"accumulated" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "fixed_assets_tag_unique" UNIQUE("tag"),
	CONSTRAINT "fixed_assets_status_chk" CHECK (status IN ('ACTIVE', 'FULLY_DEPRECIATED')),
	CONSTRAINT "fixed_assets_amounts_chk" CHECK ("fixed_assets"."cost" > 0 AND "fixed_assets"."salvage" >= 0 AND "fixed_assets"."salvage" < "fixed_assets"."cost" AND "fixed_assets"."life_months" > 0 AND "fixed_assets"."accumulated" >= 0 AND "fixed_assets"."accumulated" <= "fixed_assets"."cost" - "fixed_assets"."salvage"),
	CONSTRAINT "fixed_assets_done_chk" CHECK (("fixed_assets"."status" = 'FULLY_DEPRECIATED') = ("fixed_assets"."accumulated" = "fixed_assets"."cost" - "fixed_assets"."salvage"))
);
--> statement-breakpoint
CREATE TABLE "fs_line_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fs_line_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "fs_line_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "fs_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement" text NOT NULL,
	"code" text NOT NULL,
	"caption" text NOT NULL,
	"sort_order" integer NOT NULL,
	"section" text NOT NULL,
	"cash_flow" text,
	"computed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "fs_lines_code_unique" UNIQUE("code"),
	CONSTRAINT "fs_lines_statement_chk" CHECK (statement IN ('SFC', 'SOO')),
	CONSTRAINT "fs_lines_section_chk" CHECK (section IN ('ASSETS', 'LIABILITIES', 'EQUITY', 'REVENUE', 'EXPENSE')),
	CONSTRAINT "fs_lines_cash_flow_chk" CHECK ("fs_lines"."cash_flow" IS NULL OR "fs_lines"."cash_flow" IN ('CASH', 'OPERATING', 'INVESTING', 'FINANCING')),
	CONSTRAINT "fs_lines_statement_section_chk" CHECK (("fs_lines"."statement" = 'SFC') = ("fs_lines"."section" IN ('ASSETS', 'LIABILITIES', 'EQUITY')))
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "year_end_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"net_surplus" bigint NOT NULL,
	"je_id" uuid,
	"closed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "year_end_closes_year_unique" UNIQUE("year")
);
--> statement-breakpoint
ALTER TABLE "account_segments" ADD CONSTRAINT "account_segments_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_segments" ADD CONSTRAINT "account_segments_segment_code_segments_code_fk" FOREIGN KEY ("segment_code") REFERENCES "public"."segments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_run_id_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_recons" ADD CONSTRAINT "bank_recons_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_recons" ADD CONSTRAINT "bank_recons_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_line_id_journal_lines_id_fk" FOREIGN KEY ("matched_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_checklists" ADD CONSTRAINT "close_checklists_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_ran_by_users_id_fk" FOREIGN KEY ("ran_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_class_code_asset_classes_code_fk" FOREIGN KEY ("class_code") REFERENCES "public"."asset_classes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fs_line_accounts" ADD CONSTRAINT "fs_line_accounts_fs_line_id_fs_lines_id_fk" FOREIGN KEY ("fs_line_id") REFERENCES "public"."fs_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fs_line_accounts" ADD CONSTRAINT "fs_line_accounts_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_closes" ADD CONSTRAINT "year_end_closes_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_closes" ADD CONSTRAINT "year_end_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_lines_statement_idx" ON "bank_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "close_checklists_period_idx" ON "close_checklists" USING btree ("period");--> statement-breakpoint
CREATE INDEX "fs_line_accounts_line_idx" ON "fs_line_accounts" USING btree ("fs_line_id");