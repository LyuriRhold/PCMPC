-- Sales, their lines, returns and return lines are records: never changed or deleted.
CREATE TRIGGER sales_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER sale_lines_immutable BEFORE UPDATE OR DELETE ON sale_lines FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER sale_returns_immutable BEFORE UPDATE OR DELETE ON sale_returns FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER sale_return_lines_immutable BEFORE UPDATE OR DELETE ON sale_return_lines FOR EACH ROW EXECUTE FUNCTION store_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER member_charge_limits_no_delete BEFORE DELETE ON member_charge_limits FOR EACH ROW EXECUTE FUNCTION store_rows_reject_delete();
--> statement-breakpoint
-- A POS shift keeps its cashier, date and opening fund; it moves OPEN → CLOSED → VERIFIED and its
-- closing and verification are recorded once; never deleted.
CREATE OR REPLACE FUNCTION pos_shifts_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free text[] := ARRAY['status', 'expected_cash', 'counted_cash', 'variance', 'z_reading', 'closed_at', 'verified_by', 'verified_at', 'variance_je_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POS shifts can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RAISE EXCEPTION 'POS shifts are immutable: only the closing and verification are recorded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'VERIFIED' OR (OLD.status = 'CLOSED' AND (NEW.status <> 'VERIFIED' OR (to_jsonb(NEW) - ARRAY['status', 'verified_by', 'verified_at', 'variance_je_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'verified_by', 'verified_at', 'variance_je_id']))) THEN
    RAISE EXCEPTION 'a % POS shift can''t change that way', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'OPEN' AND NEW.status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'an open POS shift is closed first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pos_shifts_immutable
  BEFORE UPDATE OR DELETE ON pos_shifts
  FOR EACH ROW EXECUTE FUNCTION pos_shifts_reject_change();
