CREATE TABLE "cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"denomination" bigint NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "cash_counts_session_denom_uq" UNIQUE("session_id","denomination"),
	CONSTRAINT "cash_counts_qty_chk" CHECK ("cash_counts"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cash_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref_id" text,
	"reference" text,
	"amount" bigint NOT NULL,
	"out_date" date NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "cash_outs_amount_chk" CHECK ("cash_outs"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "disbursement_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dv_no" text NOT NULL,
	"dv_date" date NOT NULL,
	"payee" text NOT NULL,
	"particulars" text NOT NULL,
	"amount" bigint NOT NULL,
	"mode" text NOT NULL,
	"check_no" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"session_id" uuid,
	"je_id" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "disbursement_vouchers_dv_no_unique" UNIQUE("dv_no"),
	CONSTRAINT "dv_status_chk" CHECK (status IN ('DRAFT', 'APPROVED', 'RELEASED', 'CANCELLED')),
	CONSTRAINT "dv_mode_chk" CHECK (mode IN ('CASH', 'CHECK')),
	CONSTRAINT "dv_amount_chk" CHECK ("disbursement_vouchers"."amount" > 0),
	CONSTRAINT "dv_released_has_je" CHECK (("disbursement_vouchers"."status" = 'RELEASED') = ("disbursement_vouchers"."je_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "dv_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dv_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"member_id" uuid,
	"amount" bigint NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "dv_lines_line_uq" UNIQUE("dv_id","line_no"),
	CONSTRAINT "dv_lines_amount_chk" CHECK ("dv_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"type" text NOT NULL,
	"ref_id" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "receipt_items_line_uq" UNIQUE("receipt_id","line_no"),
	CONSTRAINT "receipt_items_amount_chk" CHECK ("receipt_items"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_no" text NOT NULL,
	"bir_receipt_no" text,
	"session_id" uuid NOT NULL,
	"payor_type" text NOT NULL,
	"payor_id" text,
	"payor_name" text NOT NULL,
	"receipt_date" date NOT NULL,
	"total" bigint NOT NULL,
	"mode" text NOT NULL,
	"check_no" text,
	"status" text DEFAULT 'VALID' NOT NULL,
	"je_id" uuid NOT NULL,
	"cancel_je_id" uuid,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_mode_chk" CHECK (mode IN ('CASH', 'CHECK', 'BANK_TRANSFER')),
	CONSTRAINT "receipts_status_chk" CHECK (status IN ('VALID', 'CANCELLED')),
	CONSTRAINT "receipts_total_chk" CHECK ("receipts"."total" > 0),
	CONSTRAINT "receipts_cancel_chk" CHECK (("receipts"."status" = 'CANCELLED') = ("receipts"."cancel_je_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "teller_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teller_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"opening_cash" bigint NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"variance" bigint,
	"closed_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"variance_je_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "teller_sessions_status_chk" CHECK (status IN ('OPEN', 'CLOSED', 'VERIFIED')),
	CONSTRAINT "teller_sessions_opening_chk" CHECK ("teller_sessions"."opening_cash" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_session_id_teller_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teller_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD CONSTRAINT "cash_outs_session_id_teller_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teller_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD CONSTRAINT "cash_outs_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_vouchers" ADD CONSTRAINT "disbursement_vouchers_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_vouchers" ADD CONSTRAINT "disbursement_vouchers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_vouchers" ADD CONSTRAINT "disbursement_vouchers_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_vouchers" ADD CONSTRAINT "disbursement_vouchers_session_id_teller_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teller_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_vouchers" ADD CONSTRAINT "disbursement_vouchers_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dv_lines" ADD CONSTRAINT "dv_lines_dv_id_disbursement_vouchers_id_fk" FOREIGN KEY ("dv_id") REFERENCES "public"."disbursement_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dv_lines" ADD CONSTRAINT "dv_lines_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dv_lines" ADD CONSTRAINT "dv_lines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_session_id_teller_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."teller_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancel_je_id_journal_entries_id_fk" FOREIGN KEY ("cancel_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teller_sessions" ADD CONSTRAINT "teller_sessions_teller_id_users_id_fk" FOREIGN KEY ("teller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teller_sessions" ADD CONSTRAINT "teller_sessions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teller_sessions" ADD CONSTRAINT "teller_sessions_variance_je_id_journal_entries_id_fk" FOREIGN KEY ("variance_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_outs_session_idx" ON "cash_outs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "receipt_items_type_idx" ON "receipt_items" USING btree ("type","ref_id");--> statement-breakpoint
CREATE INDEX "receipts_session_idx" ON "receipts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "receipts_date_idx" ON "receipts" USING btree ("receipt_date");--> statement-breakpoint
CREATE INDEX "receipts_payor_idx" ON "receipts" USING btree ("payor_type","payor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teller_sessions_one_open_uq" ON "teller_sessions" USING btree ("teller_id") WHERE "teller_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "teller_sessions_date_idx" ON "teller_sessions" USING btree ("business_date");