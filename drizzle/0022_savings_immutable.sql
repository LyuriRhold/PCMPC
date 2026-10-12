-- Savings passbook rows are never changed or deleted (a correction is a new ADJUSTMENT row).
CREATE OR REPLACE FUNCTION deposit_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deposit_transactions_immutable
  BEFORE UPDATE OR DELETE ON deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION deposit_rows_reject_change();
--> statement-breakpoint
-- A time deposit is never deleted; after placement only its closing fields change.
CREATE OR REPLACE FUNCTION time_deposits_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'time deposits can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'interest_paid', 'closed_at', 'close_je_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'interest_paid', 'closed_at', 'close_je_id']) THEN
    RAISE EXCEPTION 'time deposits are immutable: only the closing fields can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'a % time deposit can''t be changed', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER time_deposits_immutable
  BEFORE UPDATE OR DELETE ON time_deposits
  FOR EACH ROW EXECUTE FUNCTION time_deposits_reject_change();
