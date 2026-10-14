ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_tag_unique";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_status_chk";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_amounts_chk";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_done_chk";--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "opening_accumulated" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "depreciate_from" text;--> statement-breakpoint
-- Assets registered before: depreciated from the month they were acquired (the trigger would refuse the backfill).
ALTER TABLE "fixed_assets" DISABLE TRIGGER "fixed_assets_immutable";--> statement-breakpoint
UPDATE "fixed_assets" SET "depreciate_from" = to_char("acquisition_date", 'YYYY-MM');--> statement-breakpoint
ALTER TABLE "fixed_assets" ENABLE TRIGGER "fixed_assets_immutable";--> statement-breakpoint
ALTER TABLE "fixed_assets" ALTER COLUMN "depreciate_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "void_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_tag_uq" ON "fixed_assets" USING btree ("tag") WHERE "fixed_assets"."status" <> 'VOID';--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_void_chk" CHECK (("fixed_assets"."status" = 'VOID') = ("fixed_assets"."void_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_from_chk" CHECK ("fixed_assets"."depreciate_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_status_chk" CHECK (status IN ('ACTIVE', 'FULLY_DEPRECIATED', 'VOID'));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amounts_chk" CHECK ("fixed_assets"."cost" > 0 AND "fixed_assets"."salvage" >= 0 AND "fixed_assets"."salvage" < "fixed_assets"."cost" AND "fixed_assets"."life_months" > 0 AND "fixed_assets"."opening_accumulated" >= 0 AND "fixed_assets"."accumulated" >= "fixed_assets"."opening_accumulated" AND "fixed_assets"."accumulated" <= "fixed_assets"."cost" - "fixed_assets"."salvage");--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_done_chk" CHECK ("fixed_assets"."status" = 'VOID' OR ("fixed_assets"."status" = 'FULLY_DEPRECIATED') = ("fixed_assets"."accumulated" = "fixed_assets"."cost" - "fixed_assets"."salvage"));--> statement-breakpoint
-- A fixed asset keeps its terms (class, cost, salvage, life, acquisition date, the depreciation
-- brought forward and the month depreciation starts); only its description, the depreciation
-- posted (upward) and its status change. Voiding is only for an asset with no depreciation posted,
-- and a voided asset never changes again; never deleted.
CREATE OR REPLACE FUNCTION fixed_assets_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fixed assets can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'a voided fixed asset doesn''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['description', 'accumulated', 'status', 'void_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['description', 'accumulated', 'status', 'void_reason']) OR NEW.accumulated < OLD.accumulated THEN
    RAISE EXCEPTION 'a fixed asset''s class, cost, salvage, life and acquisition date don''t change; depreciation only grows' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'VOID' AND (OLD.accumulated <> OLD.opening_accumulated OR NEW.accumulated <> OLD.accumulated) THEN
    RAISE EXCEPTION 'only a fixed asset with no depreciation posted can be voided' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
