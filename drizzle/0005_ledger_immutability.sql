-- Ledger immutability (PLAN §5 rule 3, PHASE-03 data model).
-- 1. Lines of a POSTED or REVERSED entry can't be updated or deleted.
-- 2. A POSTED entry can only change status to REVERSED (with reversed_by_id); nothing else.
--    POSTED/REVERSED entries can't be deleted.
-- 3. Lines can't be added to an entry posted in an earlier transaction.
-- 4. At commit, every non-draft entry must balance (debits = credits > 0).

CREATE OR REPLACE FUNCTION journal_lines_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM journal_entries WHERE id = OLD.je_id;
  IF parent_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'journal lines of a % entry are immutable (% not allowed)', parent_status, TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_reject_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_lines_reject_late_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_xmin text;
BEGIN
  SELECT status, xmin::text INTO parent_status, parent_xmin FROM journal_entries WHERE id = NEW.je_id;
  IF parent_status IN ('POSTED', 'REVERSED')
     AND parent_xmin <> (pg_current_xact_id()::text::bigint % 4294967296)::text THEN
    RAISE EXCEPTION 'lines can''t be added to a % entry', parent_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_late_insert
  BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_reject_late_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'a % journal entry can''t be deleted', OLD.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a REVERSED journal entry is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' OR NEW.reversed_by_id IS NULL
       OR (to_jsonb(NEW) - 'status' - 'reversed_by_id') <> (to_jsonb(OLD) - 'status' - 'reversed_by_id') THEN
      RAISE EXCEPTION 'a POSTED journal entry can only be marked REVERSED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_entry_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE je uuid; st text; dr bigint; cr bigint;
BEGIN
  IF TG_TABLE_NAME = 'journal_lines' THEN je := NEW.je_id; ELSE je := NEW.id; END IF;
  SELECT status INTO st FROM journal_entries WHERE id = je;
  IF st IS NULL OR st = 'DRAFT' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO dr, cr FROM journal_lines WHERE je_id = je;
  IF dr <> cr OR dr = 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (debits %, credits %)', je, dr, cr
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balanced();
