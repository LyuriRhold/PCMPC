CREATE TABLE "member_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"birthdate" date,
	"share_pct" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "member_beneficiaries_pct_chk" CHECK ("member_beneficiaries"."share_pct" > 0 AND "member_beneficiaries"."share_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "member_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"at" timestamp with time zone NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_no" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'APPLICANT' NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"suffix" text,
	"name_key" text NOT NULL,
	"search_text" text NOT NULL,
	"birthdate" date NOT NULL,
	"sex" text NOT NULL,
	"civil_status" text NOT NULL,
	"addr_street" text,
	"addr_purok" text,
	"addr_barangay" text NOT NULL,
	"addr_municipality" text NOT NULL,
	"addr_province" text NOT NULL,
	"mobile" text,
	"email" text,
	"occupation" text,
	"employer" text,
	"tin" text,
	"valid_id_type" text,
	"valid_id_no" text,
	"pmes_date" date,
	"bod_resolution_no" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"membership_date" date,
	"privacy_consent_at" timestamp with time zone,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_member_no_unique" UNIQUE("member_no"),
	CONSTRAINT "members_type_chk" CHECK (type IN ('REGULAR', 'ASSOCIATE')),
	CONSTRAINT "members_status_chk" CHECK (status IN ('APPLICANT', 'ACTIVE', 'INACTIVE', 'TERMINATED', 'DECEASED')),
	CONSTRAINT "members_no_iff_approved" CHECK (("members"."status" = 'APPLICANT') = ("members"."member_no" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "member_beneficiaries" ADD CONSTRAINT "member_beneficiaries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_status_history" ADD CONSTRAINT "member_status_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_status_history" ADD CONSTRAINT "member_status_history_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_beneficiaries_member_idx" ON "member_beneficiaries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_status_history_member_idx" ON "member_status_history" USING btree ("member_id","at");--> statement-breakpoint
CREATE INDEX "members_dup_idx" ON "members" USING btree ("name_key","birthdate");--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");