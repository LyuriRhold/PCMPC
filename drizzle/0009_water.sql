CREATE TABLE "water_account_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"ref" text,
	"at" timestamp with time zone NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "water_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_no" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"route_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"service_address" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"connected_at" date,
	"closed_at" date,
	"deposit_amount" bigint DEFAULT 0 NOT NULL,
	"application_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_accounts_account_no_unique" UNIQUE("account_no"),
	CONSTRAINT "water_accounts_class_chk" CHECK (classification IN ('RESIDENTIAL', 'COMMERCIAL', 'INSTITUTIONAL', 'BULK')),
	CONSTRAINT "water_accounts_status_chk" CHECK (status IN ('PENDING', 'ACTIVE', 'DISCONNECTED', 'CLOSED')),
	CONSTRAINT "water_accounts_deposit_chk" CHECK ("water_accounts"."deposit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "water_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_no" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"service_address" text NOT NULL,
	"route_id" uuid,
	"status" text DEFAULT 'APPLIED' NOT NULL,
	"inspection_notes" text,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"encoded_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"account_id" uuid,
	"installed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_applications_app_no_unique" UNIQUE("app_no"),
	CONSTRAINT "water_applications_status_chk" CHECK (status IN ('APPLIED', 'INSPECTED', 'APPROVED', 'INSTALLED', 'REJECTED')),
	CONSTRAINT "water_applications_class_chk" CHECK (classification IN ('RESIDENTIAL', 'COMMERCIAL', 'INSTITUTIONAL', 'BULK'))
);
--> statement-breakpoint
CREATE TABLE "water_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_no" text NOT NULL,
	"type" text NOT NULL,
	"member_id" uuid,
	"last_name" text,
	"first_name" text,
	"middle_name" text,
	"business_name" text,
	"name_key" text NOT NULL,
	"search_text" text NOT NULL,
	"address" text NOT NULL,
	"mobile" text,
	"email" text,
	"valid_id_type" text,
	"valid_id_no" text,
	"privacy_consent_at" timestamp with time zone,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_customers_customer_no_unique" UNIQUE("customer_no"),
	CONSTRAINT "water_customers_type_chk" CHECK (type IN ('MEMBER', 'NON_MEMBER')),
	CONSTRAINT "water_customers_member_link_chk" CHECK ("water_customers"."type" <> 'MEMBER' OR "water_customers"."member_id" IS NOT NULL),
	CONSTRAINT "water_customers_name_chk" CHECK (("water_customers"."last_name" IS NOT NULL AND "water_customers"."first_name" IS NOT NULL) OR "water_customers"."business_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "water_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"mapping_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_fees_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "water_meter_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"installed_at" date NOT NULL,
	"initial_reading" integer NOT NULL,
	"removed_at" date,
	"final_reading" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_installations_readings_chk" CHECK ("water_meter_installations"."initial_reading" >= 0 AND ("water_meter_installations"."final_reading" IS NULL OR "water_meter_installations"."final_reading" >= 0)),
	CONSTRAINT "water_installations_removed_chk" CHECK (("water_meter_installations"."removed_at" IS NULL) = ("water_meter_installations"."final_reading" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "water_meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_no" text NOT NULL,
	"brand" text,
	"size" text,
	"digits" integer DEFAULT 4 NOT NULL,
	"status" text DEFAULT 'IN_STOCK' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_meters_serial_no_unique" UNIQUE("serial_no"),
	CONSTRAINT "water_meters_status_chk" CHECK (status IN ('IN_STOCK', 'INSTALLED', 'DEFECTIVE', 'RETIRED')),
	CONSTRAINT "water_meters_digits_chk" CHECK ("water_meters"."digits" BETWEEN 3 AND 9)
);
--> statement-breakpoint
CREATE TABLE "water_rate_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classification" text NOT NULL,
	"effective_from" date NOT NULL,
	"min_charge" bigint NOT NULL,
	"min_cubic" integer NOT NULL,
	"blocks" jsonb NOT NULL,
	"nwrb_ref" text NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_rate_schedules_version_uq" UNIQUE("classification","effective_from"),
	CONSTRAINT "water_rate_schedules_class_chk" CHECK (classification IN ('RESIDENTIAL', 'COMMERCIAL', 'INSTITUTIONAL', 'BULK')),
	CONSTRAINT "water_rate_schedules_amounts_chk" CHECK ("water_rate_schedules"."min_charge" >= 0 AND "water_rate_schedules"."min_cubic" >= 0)
);
--> statement-breakpoint
CREATE TABLE "water_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"assigned_reader_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_routes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "water_senior_eligibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"senior_name" text NOT NULL,
	"osca_id_no" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_senior_dates_chk" CHECK ("water_senior_eligibility"."valid_until" >= "water_senior_eligibility"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "water_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "water_zones_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "account_mappings" ADD COLUMN "requires_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "water_account_history" ADD CONSTRAINT "water_account_history_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_account_history" ADD CONSTRAINT "water_account_history_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_accounts" ADD CONSTRAINT "water_accounts_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_accounts" ADD CONSTRAINT "water_accounts_route_id_water_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."water_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_route_id_water_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."water_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_encoded_by_users_id_fk" FOREIGN KEY ("encoded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_applications" ADD CONSTRAINT "water_applications_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_customers" ADD CONSTRAINT "water_customers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_meter_installations" ADD CONSTRAINT "water_meter_installations_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_meter_installations" ADD CONSTRAINT "water_meter_installations_meter_id_water_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."water_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_routes" ADD CONSTRAINT "water_routes_zone_id_water_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."water_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_routes" ADD CONSTRAINT "water_routes_assigned_reader_id_users_id_fk" FOREIGN KEY ("assigned_reader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_senior_eligibility" ADD CONSTRAINT "water_senior_eligibility_account_id_water_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."water_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "water_account_history_idx" ON "water_account_history" USING btree ("account_id","at");--> statement-breakpoint
CREATE INDEX "water_accounts_route_seq_idx" ON "water_accounts" USING btree ("route_id","sequence_no");--> statement-breakpoint
CREATE INDEX "water_accounts_customer_idx" ON "water_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "water_applications_status_idx" ON "water_applications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "water_customers_member_uq" ON "water_customers" USING btree ("member_id") WHERE "water_customers"."type" = 'MEMBER';--> statement-breakpoint
CREATE INDEX "water_customers_name_key_idx" ON "water_customers" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "water_installations_meter_active_uq" ON "water_meter_installations" USING btree ("meter_id") WHERE "water_meter_installations"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "water_installations_account_active_uq" ON "water_meter_installations" USING btree ("account_id") WHERE "water_meter_installations"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "water_senior_account_idx" ON "water_senior_eligibility" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customer_id_water_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."water_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_customer_idx" ON "journal_lines" USING btree ("customer_id","account_id");