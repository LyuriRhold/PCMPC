-- Closing records, depreciation runs and bank reconciliations are history: never changed or deleted.
CREATE OR REPLACE FUNCTION accounting_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER close_checklists_immutable BEFORE UPDATE OR DELETE ON close_checklists FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER year_end_closes_immutable BEFORE UPDATE OR DELETE ON year_end_closes FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER depreciation_runs_immutable BEFORE UPDATE OR DELETE ON depreciation_runs FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER asset_depreciation_immutable BEFORE UPDATE OR DELETE ON asset_depreciation FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER bank_statements_immutable BEFORE UPDATE OR DELETE ON bank_statements FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER bank_statement_lines_immutable BEFORE UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER bank_recons_immutable BEFORE UPDATE OR DELETE ON bank_recons FOR EACH ROW EXECUTE FUNCTION accounting_rows_reject_change();
--> statement-breakpoint
-- A fixed asset keeps its class, cost, salvage, life and acquisition date; only its description,
-- the depreciation posted (upward) and its status change; never deleted.
CREATE OR REPLACE FUNCTION fixed_assets_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fixed assets can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['description', 'accumulated', 'status']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['description', 'accumulated', 'status']) OR NEW.accumulated < OLD.accumulated THEN
    RAISE EXCEPTION 'a fixed asset''s class, cost, salvage, life and acquisition date don''t change; depreciation only grows' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fixed_assets_immutable BEFORE UPDATE OR DELETE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION fixed_assets_reject_change();
