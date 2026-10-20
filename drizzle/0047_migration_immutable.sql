-- Data migration records (PHASE-17). An import batch is never deleted; once POSTED or ROLLED_BACK
-- it is final. The rows staged from a posted batch are the record of what was imported: they
-- can't be changed or deleted (rows of an unposted batch are deleted when it is rolled back).

CREATE OR REPLACE FUNCTION import_batches_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'import batches can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('POSTED', 'ROLLED_BACK') THEN
    RAISE EXCEPTION 'a % import batch is final', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER import_batches_immutable
  BEFORE UPDATE OR DELETE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION import_batches_reject_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stg_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'staged rows can''t be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM import_batches b WHERE b.id = OLD.batch_id AND b.status = 'POSTED') THEN
    RAISE EXCEPTION 'rows of a posted import batch can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stg_members', 'stg_share_capital', 'stg_savings', 'stg_time_deposits', 'stg_loans', 'stg_water_accounts', 'stg_water_bills', 'stg_store_stock', 'stg_suppliers', 'stg_store_ar', 'stg_trial_balance'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION stg_rows_reject_change()', t || '_immutable', t);
  END LOOP;
END;
$$;
