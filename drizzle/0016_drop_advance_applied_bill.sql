ALTER TABLE "water_customer_advances" DROP CONSTRAINT "water_customer_advances_applied_bill_id_water_bills_id_fk";
--> statement-breakpoint
ALTER TABLE "water_customer_advances" DROP COLUMN "applied_bill_id";