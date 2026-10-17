-- A posted allocation is history: only its distribution is recorded afterwards (POSTED → DISTRIBUTED);
-- an allocation is never deleted.
CREATE OR REPLACE FUNCTION surplus_allocations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'surplus allocations can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'DISTRIBUTED' THEN
    RAISE EXCEPTION 'a distributed allocation doesn''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'POSTED' AND (
    NEW.status <> 'DISTRIBUTED'
    OR (to_jsonb(NEW) - ARRAY['status', 'distributed_by', 'distributed_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'distributed_by', 'distributed_at'])
  ) THEN
    RAISE EXCEPTION 'a posted allocation only gets its distribution recorded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER surplus_allocations_guard BEFORE UPDATE OR DELETE ON surplus_allocations FOR EACH ROW EXECUTE FUNCTION surplus_allocations_guard();
--> statement-breakpoint
-- A member line's ISC and PR change only while the allocation is a draft (recomputed); afterwards only
-- the election and, once, the distribution; a distributed line never changes.
CREATE OR REPLACE FUNCTION surplus_member_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent text;
BEGIN
  SELECT status INTO parent FROM surplus_allocations WHERE id = OLD.allocation_id;
  IF TG_OP = 'DELETE' THEN
    IF parent <> 'DRAFT' THEN
      RAISE EXCEPTION 'member lines are removed only from a draft allocation' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.distributed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a distributed member line doesn''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF parent <> 'DRAFT' AND (to_jsonb(NEW) - ARRAY['elect_savings', 'elect_capitalize', 'elect_cash', 'wtax', 'arrears_offset', 'net', 'payout_savings', 'payout_capitalize', 'payout_cash', 'savings_account_id', 'je_id', 'dv_id', 'distributed_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['elect_savings', 'elect_capitalize', 'elect_cash', 'wtax', 'arrears_offset', 'net', 'payout_savings', 'payout_capitalize', 'payout_cash', 'savings_account_id', 'je_id', 'dv_id', 'distributed_at']) THEN
    RAISE EXCEPTION 'a member''s ISC and PR change only while the allocation is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER surplus_member_lines_guard BEFORE UPDATE OR DELETE ON surplus_member_lines FOR EACH ROW EXECUTE FUNCTION surplus_member_lines_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cetf_remittances_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cetf_remittances rows are immutable (% not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cetf_remittances_immutable BEFORE UPDATE OR DELETE ON cetf_remittances FOR EACH ROW EXECUTE FUNCTION cetf_remittances_reject_change();
