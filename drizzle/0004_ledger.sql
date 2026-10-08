CREATE TABLE "account_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"requires_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "account_mappings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_id" uuid,
	"level" integer DEFAULT 1 NOT NULL,
	"is_postable" boolean NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sca_code" text,
	"provisional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "gl_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "gl_accounts_type_chk" CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
	CONSTRAINT "gl_accounts_normal_balance_chk" CHECK (normal_balance IN ('DR', 'CR'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "fiscal_years_year_unique" UNIQUE("year"),
	CONSTRAINT "fiscal_years_status_chk" CHECK (status IN ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"je_no" text,
	"book" text NOT NULL,
	"entry_date" date NOT NULL,
	"reference" text,
	"particulars" text NOT NULL,
	"source_module" text NOT NULL,
	"source_id" text,
	"status" text NOT NULL,
	"prepared_by" uuid,
	"approved_by" uuid,
	"posted_at" timestamp with time zone,
	"reversal_of_id" uuid,
	"reversed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "journal_entries_je_no_unique" UNIQUE("je_no"),
	CONSTRAINT "journal_entries_book_chk" CHECK (book IN ('GJ', 'CRJ', 'CDJ', 'SJ', 'PJ')),
	CONSTRAINT "journal_entries_status_chk" CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
	CONSTRAINT "journal_entries_no_iff_posted" CHECK (("journal_entries"."status" = 'DRAFT') = ("journal_entries"."je_no" IS NULL)),
	CONSTRAINT "journal_entries_reversed_has_link" CHECK (("journal_entries"."status" = 'REVERSED') = ("journal_entries"."reversed_by_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"je_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"member_id" uuid,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "journal_lines_je_line_uq" UNIQUE("je_id","line_no"),
	CONSTRAINT "journal_lines_amounts_chk" CHECK ("journal_lines"."debit" >= 0 AND "journal_lines"."credit" >= 0 AND (("journal_lines"."debit" > 0) <> ("journal_lines"."credit" > 0)))
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "periods_year_month_uq" UNIQUE("year","month"),
	CONSTRAINT "periods_status_chk" CHECK (status IN ('OPEN', 'CLOSED')),
	CONSTRAINT "periods_month_chk" CHECK ("periods"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_parent_id_gl_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_journal_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_id_journal_entries_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gl_accounts_parent_idx" ON "gl_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source_module","source_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_member_idx" ON "journal_lines" USING btree ("member_id","account_id");