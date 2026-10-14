ALTER TABLE "sale_returns" DROP CONSTRAINT "sale_returns_amounts_chk";--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "cash_refund" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "ar_credit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing returns were wholly cash or wholly credited (the immutability trigger is off for this backfill only).
ALTER TABLE "sale_returns" DISABLE TRIGGER "sale_returns_immutable";--> statement-breakpoint
UPDATE "sale_returns" SET "cash_refund" = CASE WHEN "refund_mode" = 'CASH' THEN "total" ELSE 0 END, "ar_credit" = CASE WHEN "refund_mode" = 'AR' THEN "total" ELSE 0 END;--> statement-breakpoint
ALTER TABLE "sale_returns" ENABLE TRIGGER "sale_returns_immutable";--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_amounts_chk" CHECK ("sale_returns"."total" > 0 AND "sale_returns"."cost" >= 0 AND "sale_returns"."cash_refund" >= 0 AND "sale_returns"."ar_credit" >= 0 AND "sale_returns"."cash_refund" + "sale_returns"."ar_credit" = "sale_returns"."total" AND ("sale_returns"."cash_refund" = 0 OR "sale_returns"."shift_id" IS NOT NULL) AND (("sale_returns"."refund_mode" = 'CASH') = ("sale_returns"."ar_credit" = 0)));
