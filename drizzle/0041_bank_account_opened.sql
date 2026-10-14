ALTER TABLE "bank_accounts" ADD COLUMN "opened_on" date;--> statement-breakpoint
-- Bank accounts set up before: opened on the Manila date they were created.
UPDATE "bank_accounts" SET "opened_on" = ("created_at" AT TIME ZONE 'Asia/Manila')::date;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "opened_on" SET NOT NULL;
