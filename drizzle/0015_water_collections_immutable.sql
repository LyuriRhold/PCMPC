-- Water collections are financial records (PLAN §5 rule 3): payment allocations, penalties,
-- advances and deposit settlements are never updated or deleted. A cancelled receipt's
-- allocations and advances stop counting because their receipt is CANCELLED, not by deleting them.

CREATE OR REPLACE FUNCTION water_collections_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER water_payment_allocations_immutable
  BEFORE UPDATE OR DELETE ON water_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION water_collections_reject_change();
--> statement-breakpoint
CREATE TRIGGER water_penalties_immutable
  BEFORE UPDATE OR DELETE ON water_penalties
  FOR EACH ROW EXECUTE FUNCTION water_collections_reject_change();
--> statement-breakpoint
CREATE TRIGGER water_customer_advances_immutable
  BEFORE UPDATE OR DELETE ON water_customer_advances
  FOR EACH ROW EXECUTE FUNCTION water_collections_reject_change();
--> statement-breakpoint
CREATE TRIGGER water_deposit_settlements_immutable
  BEFORE UPDATE OR DELETE ON water_deposit_settlements
  FOR EACH ROW EXECUTE FUNCTION water_collections_reject_change();
