-- Store records that are history: never changed or deleted.
CREATE OR REPLACE FUNCTION store_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_moves_immutable
  BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER receiving_reports_immutable
  BEFORE UPDATE OR DELETE ON receiving_reports
  FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER rr_lines_immutable
  BEFORE UPDATE OR DELETE ON rr_lines
  FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER product_price_history_immutable
  BEFORE UPDATE OR DELETE ON product_price_history
  FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
-- Products, suppliers, categories and stock balances are deactivated, never deleted.
CREATE OR REPLACE FUNCTION store_rows_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can''t be deleted (deactivate them instead)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_no_delete BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION store_rows_reject_delete();
--> statement-breakpoint
CREATE TRIGGER suppliers_no_delete BEFORE DELETE ON suppliers FOR EACH ROW EXECUTE FUNCTION store_rows_reject_delete();
--> statement-breakpoint
CREATE TRIGGER product_categories_no_delete BEFORE DELETE ON product_categories FOR EACH ROW EXECUTE FUNCTION store_rows_reject_delete();
--> statement-breakpoint
CREATE TRIGGER stock_balances_no_delete BEFORE DELETE ON stock_balances FOR EACH ROW EXECUTE FUNCTION store_rows_reject_delete();
--> statement-breakpoint
-- A purchase order keeps its supplier, lines and amounts; its status moves forward only:
-- DRAFT → APPROVED | CANCELLED; APPROVED → PARTIAL | RECEIVED | CANCELLED; PARTIAL → RECEIVED | CANCELLED.
CREATE OR REPLACE FUNCTION purchase_orders_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free text[] := ARRAY['status', 'approved_by', 'approved_at', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase orders can''t be deleted (cancel them instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RAISE EXCEPTION 'purchase orders are immutable: only the status, approval and cancellation change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) OR (OLD.cancel_reason IS NOT NULL AND NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'a purchase order''s approval and cancellation are recorded once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'CANCELLED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
    OR (OLD.status = 'PARTIAL' AND NEW.status IN ('RECEIVED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'a purchase order can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER purchase_orders_immutable
  BEFORE UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION purchase_orders_reject_change();
--> statement-breakpoint
-- PO lines: only the quantity received changes, and only upward.
CREATE OR REPLACE FUNCTION po_lines_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase order lines can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'qty_received') IS DISTINCT FROM (to_jsonb(OLD) - 'qty_received') OR NEW.qty_received < OLD.qty_received THEN
    RAISE EXCEPTION 'purchase order lines are immutable: only the quantity received grows' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER po_lines_immutable
  BEFORE UPDATE OR DELETE ON po_lines
  FOR EACH ROW EXECUTE FUNCTION po_lines_reject_change();
--> statement-breakpoint
-- Stock counts: DRAFT → SUBMITTED → APPROVED; the remarks change only in DRAFT; the approval and its
-- entry are recorded once; nothing changes after approval; never deleted.
CREATE OR REPLACE FUNCTION stock_counts_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free text[] := ARRAY['status', 'submitted_at', 'approved_by', 'approved_at', 'je_id', 'remarks'];
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
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') OR (OLD.status = 'SUBMITTED' AND NEW.status = 'APPROVED')) THEN
    RAISE EXCEPTION 'a stock count can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_counts_immutable
  BEFORE UPDATE OR DELETE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION stock_counts_reject_change();
--> statement-breakpoint
-- Count lines: counted quantities change (or lines are removed) while the count is a DRAFT; on
-- submission the system quantity and variance are set; on approval the posted value; then nothing.
CREATE OR REPLACE FUNCTION stock_count_lines_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM stock_counts WHERE id = OLD.count_id;
  IF st = 'APPROVED' THEN
    RAISE EXCEPTION 'the lines of an approved stock count can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF st <> 'DRAFT' THEN
      RAISE EXCEPTION 'lines are removed only from a draft stock count' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.count_id IS DISTINCT FROM OLD.count_id OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR (st = 'SUBMITTED' AND ((to_jsonb(NEW) - 'variance_value') IS DISTINCT FROM (to_jsonb(OLD) - 'variance_value') OR OLD.variance_value IS NOT NULL)) THEN
    RAISE EXCEPTION 'a submitted stock count line changes only by its approval' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_count_lines_immutable
  BEFORE UPDATE OR DELETE ON stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION stock_count_lines_reject_change();
--> statement-breakpoint
-- AP–Trade is the supplier sub-ledger: its lines carry the supplier (Phase 12).
UPDATE account_mappings SET requires_supplier = true WHERE key = 'accounts_payable_trade';
