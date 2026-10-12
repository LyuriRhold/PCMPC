-- Penalty accruals and aging snapshots are records: never changed or deleted.
CREATE TRIGGER loan_penalty_accruals_immutable
  BEFORE UPDATE OR DELETE ON loan_penalty_accruals
  FOR EACH ROW EXECUTE FUNCTION loan_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER loan_aging_snapshots_immutable
  BEFORE UPDATE OR DELETE ON loan_aging_snapshots
  FOR EACH ROW EXECUTE FUNCTION loan_rows_reject_change();
--> statement-breakpoint
-- A loan keeps its terms; only its status and the release, write-off and closing fields change.
CREATE OR REPLACE FUNCTION loans_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loans can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'release_date', 'released_by', 'je_id', 'write_off_ref', 'write_off_je_id', 'closed_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'release_date', 'released_by', 'je_id', 'write_off_ref', 'write_off_je_id', 'closed_at']) THEN
    RAISE EXCEPTION 'loans are immutable: only the status, release, write-off and closing fields can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.je_id IS NOT NULL AND NEW.je_id IS DISTINCT FROM OLD.je_id THEN
    RAISE EXCEPTION 'a loan''s release entry can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('PAID', 'RESTRUCTURED', 'WRITTEN_OFF') AND NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'PAID' AND NEW.status IN ('ACTIVE', 'PAST_DUE')) THEN
    -- A PAID loan reopens only when its last payment is reversed.
    RAISE EXCEPTION 'a % loan can''t become %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loans_immutable
  BEFORE UPDATE OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION loans_reject_change();
--> statement-breakpoint
-- Installments: the due amounts and dates never change; nor are they deleted.
CREATE OR REPLACE FUNCTION loan_schedule_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loan installments can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.loan_id IS DISTINCT FROM OLD.loan_id OR NEW.no IS DISTINCT FROM OLD.no OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.principal_due IS DISTINCT FROM OLD.principal_due OR NEW.interest_due IS DISTINCT FROM OLD.interest_due THEN
    RAISE EXCEPTION 'an installment''s due date and amounts can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loan_schedule_immutable
  BEFORE UPDATE OR DELETE ON loan_schedule
  FOR EACH ROW EXECUTE FUNCTION loan_schedule_reject_change();
--> statement-breakpoint
-- Payments are records; only reversed_by is set, once.
CREATE OR REPLACE FUNCTION loan_payments_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loan payments can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'reversed_by') IS DISTINCT FROM (to_jsonb(OLD) - 'reversed_by') OR OLD.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'loan payments are immutable: only a reversal is recorded, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loan_payments_immutable
  BEFORE UPDATE OR DELETE ON loan_payments
  FOR EACH ROW EXECUTE FUNCTION loan_payments_reject_change();
