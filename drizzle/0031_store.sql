CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"qty_received" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "po_lines_line_uq" UNIQUE("po_id","line_no"),
	CONSTRAINT "po_lines_amounts_chk" CHECK ("po_lines"."qty" > 0 AND "po_lines"."unit_cost" >= 0 AND "po_lines"."line_total" = "po_lines"."qty" * "po_lines"."unit_cost" AND "po_lines"."qty_received" >= 0 AND "po_lines"."qty_received" <= "po_lines"."qty")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_price_history_price_chk" CHECK ("product_price_history"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"category_id" uuid,
	"selling_price" bigint NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"vat_class" text DEFAULT 'VAT_EXEMPT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "products_price_chk" CHECK ("products"."selling_price" >= 0 AND "products"."reorder_level" >= 0),
	CONSTRAINT "products_vat_class_chk" CHECK (vat_class IN ('VAT', 'VAT_EXEMPT', 'ZERO_RATED'))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"remarks" text,
	"total" bigint NOT NULL,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "purchase_orders_po_no_unique" UNIQUE("po_no"),
	CONSTRAINT "purchase_orders_status_chk" CHECK (status IN ('DRAFT', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
	CONSTRAINT "purchase_orders_total_chk" CHECK ("purchase_orders"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receiving_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rr_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_id" uuid,
	"rr_date" date NOT NULL,
	"invoice_no" text,
	"payment" text NOT NULL,
	"total" bigint NOT NULL,
	"due_date" date NOT NULL,
	"dv_id" uuid,
	"received_by" uuid NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "receiving_reports_rr_no_unique" UNIQUE("rr_no"),
	CONSTRAINT "receiving_reports_payment_chk" CHECK (payment IN ('CASH', 'ON_ACCOUNT')),
	CONSTRAINT "receiving_reports_total_chk" CHECK ("receiving_reports"."total" > 0)
);
--> statement-breakpoint
CREATE TABLE "rr_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rr_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"po_line_id" uuid,
	"qty" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "rr_lines_line_uq" UNIQUE("rr_id","line_no"),
	CONSTRAINT "rr_lines_amounts_chk" CHECK ("rr_lines"."qty" > 0 AND "rr_lines"."unit_cost" >= 0 AND "rr_lines"."line_total" = "rr_lines"."qty" * "rr_lines"."unit_cost")
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"avg_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_balances_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "stock_balances_chk" CHECK ("stock_balances"."qty" >= 0 AND "stock_balances"."value" >= 0 AND ("stock_balances"."qty" > 0 OR "stock_balances"."value" = 0))
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"system_qty" integer,
	"counted_qty" integer,
	"variance" integer,
	"variance_value" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_count_lines_uq" UNIQUE("count_id","product_id"),
	CONSTRAINT "stock_count_lines_qty_chk" CHECK (("stock_count_lines"."counted_qty" IS NULL OR "stock_count_lines"."counted_qty" >= 0) AND ("stock_count_lines"."system_qty" IS NULL OR "stock_count_lines"."system_qty" >= 0) AND ("stock_count_lines"."variance" IS NULL OR "stock_count_lines"."variance" = "stock_count_lines"."counted_qty" - "stock_count_lines"."system_qty"))
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_no" text NOT NULL,
	"count_date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"remarks" text,
	"prepared_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"je_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_counts_count_no_unique" UNIQUE("count_no"),
	CONSTRAINT "stock_counts_status_chk" CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED'))
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"move_date" date NOT NULL,
	"type" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"total_cost" bigint NOT NULL,
	"qty_after" integer NOT NULL,
	"avg_cost_after" numeric(14, 4) NOT NULL,
	"value_after" bigint NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"je_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_moves_type_chk" CHECK (type IN ('RECEIVE', 'SALE', 'RETURN', 'ADJUST')),
	CONSTRAINT "stock_moves_amounts_chk" CHECK ("stock_moves"."qty" <> 0 AND (("stock_moves"."qty" > 0 AND "stock_moves"."total_cost" >= 0) OR ("stock_moves"."qty" < 0 AND "stock_moves"."total_cost" <= 0)) AND "stock_moves"."qty_after" >= 0 AND "stock_moves"."value_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"tin" text,
	"terms_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name"),
	CONSTRAINT "suppliers_terms_chk" CHECK ("suppliers"."terms_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD COLUMN "requires_supplier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "dv_lines" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_reports" ADD CONSTRAINT "receiving_reports_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_reports" ADD CONSTRAINT "receiving_reports_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_reports" ADD CONSTRAINT "receiving_reports_dv_id_disbursement_vouchers_id_fk" FOREIGN KEY ("dv_id") REFERENCES "public"."disbursement_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_reports" ADD CONSTRAINT "receiving_reports_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_reports" ADD CONSTRAINT "receiving_reports_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rr_lines" ADD CONSTRAINT "rr_lines_rr_id_receiving_reports_id_fk" FOREIGN KEY ("rr_id") REFERENCES "public"."receiving_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rr_lines" ADD CONSTRAINT "rr_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rr_lines" ADD CONSTRAINT "rr_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_price_history_product_idx" ON "product_price_history" USING btree ("product_id","effective_at");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "receiving_reports_supplier_idx" ON "receiving_reports" USING btree ("supplier_id","rr_date");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_moves" USING btree ("product_id","move_date");--> statement-breakpoint
CREATE INDEX "stock_moves_ref_idx" ON "stock_moves" USING btree ("ref_type","ref_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dv_lines" ADD CONSTRAINT "dv_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_supplier_idx" ON "journal_lines" USING btree ("supplier_id","account_id");