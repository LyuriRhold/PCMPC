ALTER TABLE "loans" DROP CONSTRAINT "loans_status_chk";--> statement-breakpoint
ALTER TABLE "loans" DROP CONSTRAINT "loans_released_chk";--> statement-breakpoint
ALTER TABLE "loan_aging_snapshots" ADD COLUMN "amount_past_due" bigint;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "restructure_ref" text;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_status_chk" CHECK (status IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'PAID', 'RESTRUCTURED', 'WRITTEN_OFF', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_released_chk" CHECK (("loans"."status" IN ('PENDING', 'CANCELLED')) = ("loans"."je_id" IS NULL));--> statement-breakpoint
-- A loan keeps its terms. Its status, release, write-off and closing fields change; the release and
-- write-off are recorded once; the closing date changes only with the status. While PENDING it can be
-- authorized again (a new first due date) or CANCELLED (reviewer follow-up, Phase 11).
CREATE OR REPLACE FUNCTION loans_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free text[] := ARRAY['status', 'release_date', 'released_by', 'je_id', 'write_off_ref', 'write_off_je_id', 'closed_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loans can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status = 'PENDING' THEN
    free := free || ARRAY['first_due_date', 'maturity_date', 'authorized_by'];
  END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RAISE EXCEPTION 'loans are immutable: only the status, release, write-off and closing fields can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.je_id IS NOT NULL AND NEW.je_id IS DISTINCT FROM OLD.je_id)
     OR (OLD.release_date IS NOT NULL AND NEW.release_date IS DISTINCT FROM OLD.release_date)
     OR (OLD.released_by IS NOT NULL AND NEW.released_by IS DISTINCT FROM OLD.released_by)
     OR (OLD.write_off_ref IS NOT NULL AND NEW.write_off_ref IS DISTINCT FROM OLD.write_off_ref)
     OR (OLD.write_off_je_id IS NOT NULL AND NEW.write_off_je_id IS DISTINCT FROM OLD.write_off_je_id) THEN
    RAISE EXCEPTION 'a loan''s release and write-off are recorded once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a loan''s closing date changes only with its status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('PAID', 'RESTRUCTURED', 'WRITTEN_OFF', 'CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'PAID' AND NEW.status IN ('ACTIVE', 'PAST_DUE')) THEN
    -- A PAID loan reopens only when its last payment is reversed.
    RAISE EXCEPTION 'a % loan can''t become %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' AND OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'only a loan not yet paid out can be cancelled' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Application statuses move forward only; a RELEASED application is CANCELLED with its loan when the
-- loan was cancelled before its payout.
CREATE OR REPLACE FUNCTION loan_applications_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loan applications can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'loan applications are immutable: only the status can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'SUBMITTED' AND NEW.status IN ('RECOMMENDED', 'APPROVED', 'REJECTED', 'CANCELLED'))
    OR (OLD.status = 'RECOMMENDED' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('RELEASED', 'CANCELLED'))
    OR (OLD.status = 'RELEASED' AND NEW.status = 'CANCELLED' AND EXISTS (SELECT 1 FROM loans l WHERE l.application_id = OLD.id AND l.status = 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'a loan application can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
