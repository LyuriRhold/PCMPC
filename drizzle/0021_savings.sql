CREATE TABLE "deposit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_no" text NOT NULL,
	"member_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" date NOT NULL,
	"closed_at" date,
	"last_customer_txn_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "deposit_accounts_account_no_unique" UNIQUE("account_no"),
	CONSTRAINT "deposit_accounts_status_chk" CHECK (status IN ('OPEN', 'DORMANT', 'CLOSED')),
	CONSTRAINT "deposit_accounts_closed_chk" CHECK (("deposit_accounts"."status" = 'CLOSED') = ("deposit_accounts"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "deposit_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"rate_pa" text NOT NULL,
	"interest_basis" text NOT NULL,
	"crediting" text NOT NULL,
	"min_balance_earn" bigint DEFAULT 0 NOT NULL,
	"maintaining_balance" bigint DEFAULT 0 NOT NULL,
	"dormant_after_months" integer,
	"wtax_rate" text DEFAULT '0' NOT NULL,
	"deposit_gl_key" text NOT NULL,
	"interest_gl_key" text NOT NULL,
	"wtax_gl_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "deposit_products_code_unique" UNIQUE("code"),
	CONSTRAINT "deposit_products_kind_chk" CHECK (kind IN ('SAVINGS', 'TIME')),
	CONSTRAINT "deposit_products_amounts_chk" CHECK ("deposit_products"."min_balance_earn" >= 0 AND "deposit_products"."maintaining_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "deposit_transactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"ref_no" text,
	"bir_receipt_no" text,
	"receipt_item_id" uuid,
	"je_id" uuid NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "deposit_transactions_type_chk" CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'WTAX', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT')),
	CONSTRAINT "deposit_transactions_sign_chk" CHECK ("deposit_transactions"."amount" <> 0 AND ("deposit_transactions"."type" = 'ADJUSTMENT' OR ("deposit_transactions"."type" IN ('DEPOSIT', 'INTEREST', 'TRANSFER_IN') AND "deposit_transactions"."amount" > 0) OR ("deposit_transactions"."type" IN ('WITHDRAWAL', 'WTAX', 'TRANSFER_OUT') AND "deposit_transactions"."amount" < 0))),
	CONSTRAINT "deposit_transactions_balance_chk" CHECK ("deposit_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "time_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"certificate_no" text NOT NULL,
	"principal" bigint NOT NULL,
	"rate_pa" text NOT NULL,
	"term_days" integer NOT NULL,
	"placement_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"interest_paid" bigint DEFAULT 0 NOT NULL,
	"savings_account_id" uuid NOT NULL,
	"rolled_from_id" uuid,
	"je_id" uuid NOT NULL,
	"closed_at" date,
	"close_je_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "time_deposits_status_chk" CHECK (status IN ('ACTIVE', 'MATURED', 'PRETERMINATED', 'ROLLED_OVER')),
	CONSTRAINT "time_deposits_amounts_chk" CHECK ("time_deposits"."principal" > 0 AND "time_deposits"."term_days" > 0 AND "time_deposits"."interest_paid" >= 0),
	CONSTRAINT "time_deposits_closed_chk" CHECK (("time_deposits"."status" = 'ACTIVE') = ("time_deposits"."closed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_product_id_deposit_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."deposit_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_account_id_deposit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."deposit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_deposits" ADD CONSTRAINT "time_deposits_account_id_deposit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."deposit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_deposits" ADD CONSTRAINT "time_deposits_savings_account_id_deposit_accounts_id_fk" FOREIGN KEY ("savings_account_id") REFERENCES "public"."deposit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_deposits" ADD CONSTRAINT "time_deposits_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_deposits" ADD CONSTRAINT "time_deposits_close_je_id_journal_entries_id_fk" FOREIGN KEY ("close_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_accounts_member_idx" ON "deposit_accounts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "deposit_transactions_account_idx" ON "deposit_transactions" USING btree ("account_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "time_deposits_certificate_uq" ON "time_deposits" USING btree ("certificate_no");--> statement-breakpoint
CREATE INDEX "time_deposits_account_idx" ON "time_deposits" USING btree ("account_id");