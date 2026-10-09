-- Water bill immutability (PLAN §5 rule 3, PHASE-06: bills are never edited after posting).
-- 1. Bills can't be deleted. Only `status` may change (UNPAID → PARTIAL → PAID, CANCELLED by memo, Phase 07).
-- 2. Bill lines can't be updated or deleted.
-- 3. An APPROVED credit/debit memo can't be updated or deleted; PENDING/REJECTED ones can't be deleted.

CREATE OR REPLACE FUNCTION water_bills_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'water bills are immutable (DELETE not allowed)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'water bills are immutable: only the status can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER water_bills_immutable
  BEFORE UPDATE OR DELETE ON water_bills
  FOR EACH ROW EXECUTE FUNCTION water_bills_reject_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION water_bill_lines_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'water bill lines are immutable (% not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER water_bill_lines_immutable
  BEFORE UPDATE OR DELETE ON water_bill_lines
  FOR EACH ROW EXECUTE FUNCTION water_bill_lines_reject_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION water_bill_adjustments_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'water bill adjustments can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a % water bill adjustment is immutable', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER water_bill_adjustments_immutable
  BEFORE UPDATE OR DELETE ON water_bill_adjustments
  FOR EACH ROW EXECUTE FUNCTION water_bill_adjustments_reject_change();
