ALTER TABLE "stock_counts" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receiving_reports_invoice_uq" ON "receiving_reports" USING btree ("supplier_id",lower("invoice_no")) WHERE "receiving_reports"."invoice_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_moves_product_seq_idx" ON "stock_moves" USING btree ("product_id","seq");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sod_chk" CHECK ("purchase_orders"."approved_by" IS NULL OR "purchase_orders"."approved_by" <> "purchase_orders"."prepared_by");--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_sod_chk" CHECK ("stock_counts"."approved_by" IS NULL OR ("stock_counts"."approved_by" <> "stock_counts"."prepared_by" AND "stock_counts"."approved_by" IS DISTINCT FROM "stock_counts"."submitted_by"));--> statement-breakpoint
-- Stock counts: DRAFT → SUBMITTED → APPROVED, and SUBMITTED → DRAFT when the manager returns a sheet
-- to the clerk (reviewer follow-up); the remarks change only in DRAFT; nothing changes after
-- approval; never deleted.
CREATE OR REPLACE FUNCTION stock_counts_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free text[] := ARRAY['status', 'submitted_at', 'submitted_by', 'approved_by', 'approved_at', 'je_id', 'remarks'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock counts can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'an approved stock count can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) OR (OLD.status <> 'DRAFT' AND NEW.remarks IS DISTINCT FROM OLD.remarks) THEN
    RAISE EXCEPTION 'stock counts are immutable: only the status and its approval change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'DRAFT'))) THEN
    RAISE EXCEPTION 'a stock count can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
