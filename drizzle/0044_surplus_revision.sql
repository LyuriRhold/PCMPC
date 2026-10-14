ALTER TABLE "surplus_allocations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- An approved allocation keeps its figures: it is only posted, or sent back to draft (by the manager).
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
  IF OLD.status = 'APPROVED' AND (
    NEW.status NOT IN ('DRAFT', 'POSTED')
    OR (to_jsonb(NEW) - ARRAY['status', 'approved_by', 'approved_at', 'ga_resolution_no', 'posted_by', 'posted_at', 'je_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'approved_by', 'approved_at', 'ga_resolution_no', 'posted_by', 'posted_at', 'je_id'])
  ) THEN
    RAISE EXCEPTION 'an approved allocation keeps its figures: post it or send it back to draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Member lines are added only to a draft allocation (drafting and recomputing).
CREATE OR REPLACE FUNCTION surplus_member_lines_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM surplus_allocations WHERE id = NEW.allocation_id) IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'member lines are added only to a draft allocation' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER surplus_member_lines_insert_guard BEFORE INSERT ON surplus_member_lines FOR EACH ROW EXECUTE FUNCTION surplus_member_lines_insert_guard();
