ALTER TABLE "loan_products" DROP CONSTRAINT "loan_products_amounts_chk";--> statement-breakpoint
ALTER TABLE "loan_products" ADD COLUMN "min_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The DOMAIN sample products get a ₱1,000.00 minimum (CONFIRM Q-10.9).
UPDATE "loan_products" SET "min_amount" = 100000 WHERE "code" IN ('REG', 'EMR', 'PRD') AND "min_amount" = 0;--> statement-breakpoint
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_amounts_chk" CHECK ("loan_products"."min_amount" >= 0 AND ("loan_products"."max_amount" IS NULL OR "loan_products"."max_amount" >= "loan_products"."min_amount") AND "loan_products"."required_comakers" >= 0 AND "loan_products"."grace_days" >= 0);--> statement-breakpoint
ALTER TABLE "loan_applications" ADD COLUMN "receivable_gl_key" text;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD COLUMN "penalty_rate_pm" text;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD COLUMN "grace_days" integer;--> statement-breakpoint
-- Existing applications take the terms from their product (the immutability trigger is off for this backfill only).
ALTER TABLE "loan_applications" DISABLE TRIGGER "loan_applications_immutable";--> statement-breakpoint
UPDATE "loan_applications" a SET "receivable_gl_key" = p."receivable_gl_key", "penalty_rate_pm" = p."penalty_rate_pm", "grace_days" = p."grace_days" FROM "loan_products" p WHERE p."id" = a."product_id";--> statement-breakpoint
ALTER TABLE "loan_applications" ENABLE TRIGGER "loan_applications_immutable";--> statement-breakpoint
ALTER TABLE "loan_applications" ALTER COLUMN "receivable_gl_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_applications" ALTER COLUMN "penalty_rate_pm" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_applications" ALTER COLUMN "grace_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_approvals" ADD COLUMN "resulting_status" text;--> statement-breakpoint
ALTER TABLE "loan_approvals" ADD COLUMN "eligibility" jsonb;--> statement-breakpoint
-- Only the status changes after submission, and only forward: SUBMITTED → RECOMMENDED | APPROVED |
-- REJECTED | CANCELLED; RECOMMENDED → APPROVED | REJECTED | CANCELLED; APPROVED → RELEASED | CANCELLED.
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
  ) THEN
    RAISE EXCEPTION 'a loan application can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
