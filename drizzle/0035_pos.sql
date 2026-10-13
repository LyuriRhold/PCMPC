CREATE TABLE "member_charge_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"limit_amount" bigint NOT NULL,
	"set_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "member_charge_limits_member_id_unique" UNIQUE("member_id"),
	CONSTRAINT "member_charge_limits_amount_chk" CHECK ("member_charge_limits"."limit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cashier_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"opening_fund" bigint NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"variance" bigint,
	"z_reading" jsonb,
	"closed_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"variance_je_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pos_shifts_status_chk" CHECK (status IN ('OPEN', 'CLOSED', 'VERIFIED')),
	CONSTRAINT "pos_shifts_amounts_chk" CHECK ("pos_shifts"."opening_fund" >= 0 AND ("pos_shifts"."counted_cash" IS NULL OR "pos_shifts"."counted_cash" >= 0)),
	CONSTRAINT "pos_shifts_closed_chk" CHECK (("pos_shifts"."status" = 'OPEN') = ("pos_shifts"."counted_cash" IS NULL)),
	CONSTRAINT "pos_shifts_sod_chk" CHECK ("pos_shifts"."verified_by" IS NULL OR "pos_shifts"."verified_by" <> "pos_shifts"."cashier_id")
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"cogs" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sale_lines_line_uq" UNIQUE("sale_id","line_no"),
	CONSTRAINT "sale_lines_amounts_chk" CHECK ("sale_lines"."qty" > 0 AND "sale_lines"."unit_price" >= 0 AND "sale_lines"."discount" >= 0 AND "sale_lines"."line_total" = "sale_lines"."qty" * "sale_lines"."unit_price" - "sale_lines"."discount" AND "sale_lines"."cogs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"cost" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sale_return_lines_amounts_chk" CHECK ("sale_return_lines"."qty" > 0 AND "sale_return_lines"."amount" >= 0 AND "sale_return_lines"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"shift_id" uuid,
	"return_date" date NOT NULL,
	"refund_mode" text NOT NULL,
	"total" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"reason" text NOT NULL,
	"cashier_id" uuid NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sale_returns_return_no_unique" UNIQUE("return_no"),
	CONSTRAINT "sale_returns_mode_chk" CHECK (refund_mode IN ('CASH', 'AR')),
	CONSTRAINT "sale_returns_amounts_chk" CHECK ("sale_returns"."total" > 0 AND "sale_returns"."cost" >= 0 AND ("sale_returns"."refund_mode" = 'AR' OR "sale_returns"."shift_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_no" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"cashier_id" uuid NOT NULL,
	"member_id" uuid,
	"customer_type" text NOT NULL,
	"payment" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"tendered" bigint,
	"change" bigint,
	"status" text NOT NULL,
	"je_id" uuid,
	"bir_invoice_no" text,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sales_sale_no_unique" UNIQUE("sale_no"),
	CONSTRAINT "sales_customer_type_chk" CHECK (customer_type IN ('MEMBER', 'NON_MEMBER')),
	CONSTRAINT "sales_payment_chk" CHECK (payment IN ('CASH', 'CHARGE')),
	CONSTRAINT "sales_status_chk" CHECK (status IN ('COMPLETED', 'VOIDED')),
	CONSTRAINT "sales_member_chk" CHECK (("sales"."customer_type" = 'MEMBER') = ("sales"."member_id" IS NOT NULL) AND ("sales"."payment" = 'CASH' OR "sales"."member_id" IS NOT NULL)),
	CONSTRAINT "sales_amounts_chk" CHECK ("sales"."subtotal" >= 0 AND "sales"."discount" >= 0 AND "sales"."total" = "sales"."subtotal" - "sales"."discount" AND ("sales"."change" IS NULL OR ("sales"."change" >= 0 AND "sales"."tendered" = "sales"."total" + "sales"."change"))),
	CONSTRAINT "sales_posted_chk" CHECK (("sales"."status" = 'COMPLETED') = ("sales"."je_id" IS NOT NULL) AND ("sales"."status" = 'COMPLETED' OR ("sales"."voided_by" IS NOT NULL AND "sales"."void_reason" IS NOT NULL AND "sales"."voided_by" <> "sales"."cashier_id")))
);
--> statement-breakpoint
ALTER TABLE "member_charge_limits" ADD CONSTRAINT "member_charge_limits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_charge_limits" ADD CONSTRAINT "member_charge_limits_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_variance_je_id_journal_entries_id_fk" FOREIGN KEY ("variance_je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shifts_open_uq" ON "pos_shifts" USING btree ("cashier_id") WHERE "pos_shifts"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "pos_shifts_date_idx" ON "pos_shifts" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "sale_lines_product_idx" ON "sale_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_return_lines_line_idx" ON "sale_return_lines" USING btree ("sale_line_id");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_shift_idx" ON "sale_returns" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "sales_shift_idx" ON "sales" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "sales_member_idx" ON "sales" USING btree ("member_id","sale_date");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("sale_date");