-- Reviewer follow-up (Phase 03): close two raw-SQL paths around posted entries.
-- 1. A line can never move to another entry (moving a draft line into a POSTED entry would
--    change posted books without touching the posted lines themselves).
-- 2. The deferred balance check also runs after line updates, so any change that leaves a
--    non-draft entry unbalanced fails at commit.
CREATE OR REPLACE FUNCTION journal_lines_reject_reparent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.je_id <> OLD.je_id THEN
    RAISE EXCEPTION 'a journal line can''t be moved to another entry' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_reparent
  BEFORE UPDATE OF je_id ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_reject_reparent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced_on_update
  AFTER UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balanced();
