-- Loan approvals are a record of decisions: never changed or deleted.
CREATE OR REPLACE FUNCTION loan_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loan_approvals_immutable
  BEFORE UPDATE OR DELETE ON loan_approvals
  FOR EACH ROW EXECUTE FUNCTION loan_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER loan_application_comakers_immutable
  BEFORE UPDATE OR DELETE ON loan_application_comakers
  FOR EACH ROW EXECUTE FUNCTION loan_rows_reject_change();
--> statement-breakpoint
-- A submitted application keeps what it was decided on; only its status changes.
CREATE OR REPLACE FUNCTION loan_applications_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loan applications can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'loan applications are immutable: only the status can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loan_applications_immutable
  BEFORE UPDATE OR DELETE ON loan_applications
  FOR EACH ROW EXECUTE FUNCTION loan_applications_reject_change();
