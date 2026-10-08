ALTER TABLE "cash_counts" DROP CONSTRAINT "cash_counts_session_denom_uq";--> statement-breakpoint
ALTER TABLE "cash_counts" ADD COLUMN "kind" text DEFAULT 'BILL' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_session_denom_kind_uq" UNIQUE("session_id","denomination","kind");--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_kind_chk" CHECK ("cash_counts"."kind" IN ('BILL', 'COIN'));