CREATE TABLE "share_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"bod_ref" text NOT NULL,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"je_id" uuid,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "share_withdrawals_status_chk" CHECK (status IN ('APPROVED', 'PAID', 'CANCELLED')),
	CONSTRAINT "share_withdrawals_paid_chk" CHECK (("share_withdrawals"."status" = 'PAID') = ("share_withdrawals"."je_id" IS NOT NULL AND "share_withdrawals"."paid_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "share_withdrawals" ADD CONSTRAINT "share_withdrawals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_withdrawals" ADD CONSTRAINT "share_withdrawals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_withdrawals" ADD CONSTRAINT "share_withdrawals_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_withdrawals" ADD CONSTRAINT "share_withdrawals_je_id_journal_entries_id_fk" FOREIGN KEY ("je_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_withdrawals" ADD CONSTRAINT "share_withdrawals_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_withdrawals_open_uq" ON "share_withdrawals" USING btree ("member_id") WHERE "share_withdrawals"."status" = 'APPROVED';