CREATE TABLE "cetf_remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"dv_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "cetf_remittances_dv_id_unique" UNIQUE("dv_id"),
	CONSTRAINT "cetf_remittances_amount_chk" CHECK ("cetf_remittances"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "surplus_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiscal_year" integer NOT NULL,
	"net_surplus" bigint NOT NULL,
	"reserve_pct" text NOT NULL,
	"etf_pct" text NOT NULL,
	"cdf_pct" text NOT NULL,
	"optional_pct" text NOT NULL,
	"isc_share" text NOT NULL,
	"pr_share" text NOT NULL,
	"pr_basis" jsonb NOT NULL,
	"wtax_rate" text NOT NULL,
	"offset_arrears" boolean NOT NULL,
	"reserve" bigint NOT NULL,
	"etf_local" bigint NOT NULL,
	"cetf" bigint NOT NULL,
	"cdf" bigint NOT NULL,
	"optional" bigint NOT NULL,
	"remaining" bigint NOT NULL,
	"isc_pool" bigint NOT NULL,
	"pr_pool" bigint NOT NULL,
	"isc_rate" text NOT NULL,
	"pr_rate" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"ga_resolution_no" text,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"je_id" uuid,
	"distributed_by" uuid,
	"distributed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "surplus_allocations_fiscal_year_unique" UNIQUE("fiscal_year"),
	CONSTRAINT "surplus_allocations_status_chk" CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'DISTRIBUTED')),
	CONSTRAINT "surplus_allocations_split_chk" CHECK ("surplus_allocations"."net_surplus" > 0 AND "surplus_allocations"."reserve" >= 0 AND "surplus_allocations"."etf_local" >= 0 AND "surplus_allocations"."cetf" >= 0 AND "surplus_allocations"."cdf" >= 0 AND "surplus_allocations"."optional" >= 0 AND "surplus_allocations"."isc_pool" >= 0 AND "surplus_allocations"."pr_pool" >= 0 AND "surplus_allocations"."reserve" + "surplus_allocations"."etf_local" + "surplus_allocations"."cetf" + "surplus_allocations"."cdf" + "surplus_allocations"."optional" + "surplus_allocations"."remaining" = "surplus_allocations"."net_surplus" AND "surplus_allocations"."isc_pool" + "surplus_allocations"."pr_pool" = "surplus_allocations"."remaining"),
	CONSTRAINT "surplus_allocations_sod_chk" CHECK ("surplus_allocations"."approved_by" IS NULL OR "surplus_allocations"."approved_by" <> "surplus_allocations"."prepared_by"),
	CONSTRAINT "surplus_allocations_posted_chk" CHECK (("surplus_allocations"."status" IN ('POSTED', 'DISTRIBUTED')) = ("surplus_allocations"."je_id" IS NOT NULL) AND ("surplus_allocations"."je_id" IS NULL OR ("surplus_allocations"."ga_resolution_no" IS NOT NULL AND "surplus_allocations"."approved_by" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "surplus_member_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"asm" bigint NOT NULL,
	"isc" bigint NOT NULL,
	"patronage_loan_interest" bigint NOT NULL,
	"patronage_store" bigint NOT NULL,
	"patronage_water" bigint NOT NULL,
	"patronage_total" bigint NOT NULL,
	"pr" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"elect_savings" integer NOT NULL,
	"elect_capitalize" integer NOT NULL,
	"elect_cash" integer NOT NULL,
	"wtax" bigint DEFAULT 0 NOT NULL,
	"arrears_offset" bigint DEFAULT 0 NOT NULL,
	"net" bigint NOT NULL,
	"payout_savings" bigint DEFAULT 0 NOT NULL,
	"payout_capitalize" bigint DEFAULT 0 NOT NULL,
	"payout_cash" bigint DEFAULT 0 NOT NULL,
	"savings_account_id" uuid,
	"je_id" uuid,
	"dv_id" uuid,
	"distributed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "surplus_member_lines_uq" UNIQUE("allocation_id","member_id"),
	CONSTRAINT "surplus_member_lines_amounts_chk" CHECK ("surplus_member_lines"."asm" >= 0 AND "surplus_member_lines"."isc" >= 0 AND "surplus_member_lines"."patronage_loan_interest" >= 0 AND "surplus_member_lines"."patronage_store" >= 0 AND "surplus_member_lines"."patronage_water" >= 0 AND "surplus_member_lines"."patronage_total" >= 0 AND "surplus_member_lines"."pr" >= 0 AND "surplus_member_lines"."gross" = "surplus_member_lines"."isc" + "surplus_member_lines"."pr" AND "surplus_member_lines"."gross" > 0 AND "surplus_member_lines"."wtax" >= 0 AND "surplus_member_lines"."arrears_offset" >= 0 AND "surplus_member_lines"."net" = "surplus_member_lines"."gross" - "surplus_member_lines"."wtax" - "surplus_member_lines"."arrears_offset" AND "surplus_member_lines"."net" >= 0 AND "surplus_member_lines"."payout_savings" >= 0 AND "surplus_member_lines"."payout_capitalize" >= 0 AND "surplus_member_lines"."payout_cash" >= 0),
	CONSTRAINT "surplus_member_lines_election_chk" CHECK ("surplus_member_lines"."elect_savings" >= 0 AND "surplus_member_lines"."elect_capitalize" >= 0 AND "surplus_member_lines"."elect_cash" >= 0 AND "surplus_member_lines"."elect_savings" + "surplus_member_lines"."elect_capitalize" + "surplus_member_lines"."elect_cash" = 10000),
	CONSTRAINT "surplus_member_lines_paid_chk" CHECK ("surplus_member_lines"."distributed_at" IS NULL OR "surplus_member_lines"."payout_savings" + "surplus_member_lines"."payout_capitalize" + "surplus_member_lines"."payout_cash" = "surplus_member_lines"."net")
);
--> statement-breakpoint
ALTER TABLE "cetf_remittances" ADD CONSTRAINT "cetf_remittances_allocation_id_surplus_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."surplus_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cetf_remittances" ADD CONSTRAINT "cetf_remittances_dv_id_disbursement_vouchers_id_fk" FOREIGN KEY ("dv_id") REFERENCES "public"."disbursement_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_allocations" ADD CONSTRAINT "surplus_allocations_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_allocations" ADD CONSTRAINT "surplus_allocations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_allocations" ADD CONSTRAINT "surplus_allocations_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_allocations" ADD CONSTRAINT "surplus_allocations_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_allocations" ADD CONSTRAINT "surplus_allocations_distributed_by_users_id_fk" FOREIGN KEY ("distributed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_member_lines" ADD CONSTRAINT "surplus_member_lines_allocation_id_surplus_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."surplus_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_member_lines" ADD CONSTRAINT "surplus_member_lines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_member_lines" ADD CONSTRAINT "surplus_member_lines_savings_account_id_deposit_accounts_id_fk" FOREIGN KEY ("savings_account_id") REFERENCES "public"."deposit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_member_lines" ADD CONSTRAINT "surplus_member_lines_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_member_lines" ADD CONSTRAINT "surplus_member_lines_dv_id_disbursement_vouchers_id_fk" FOREIGN KEY ("dv_id") REFERENCES "public"."disbursement_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cetf_remittances_allocation_idx" ON "cetf_remittances" USING btree ("allocation_id");--> statement-breakpoint
CREATE INDEX "surplus_member_lines_member_idx" ON "surplus_member_lines" USING btree ("member_id");