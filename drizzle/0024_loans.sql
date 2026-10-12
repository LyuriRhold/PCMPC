CREATE TABLE "loan_application_comakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "loan_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_no" text NOT NULL,
	"member_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"term" integer NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"method" text NOT NULL,
	"rate_pm" text NOT NULL,
	"first_due_date" date NOT NULL,
	"eligibility" jsonb NOT NULL,
	"schedule_preview" jsonb NOT NULL,
	"deductions" jsonb NOT NULL,
	"net_proceeds" bigint NOT NULL,
	"total_interest" bigint NOT NULL,
	"encoded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_applications_app_no_unique" UNIQUE("app_no"),
	CONSTRAINT "loan_applications_status_chk" CHECK (status IN ('SUBMITTED', 'RECOMMENDED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RELEASED')),
	CONSTRAINT "loan_applications_amounts_chk" CHECK ("loan_applications"."amount" > 0 AND "loan_applications"."term" > 0 AND "loan_applications"."net_proceeds" >= 0 AND "loan_applications"."total_interest" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loan_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"level" text NOT NULL,
	"decision" text NOT NULL,
	"remarks" text,
	"by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_approvals_level_chk" CHECK (level IN ('MANAGER', 'CREDIT_COMMITTEE')),
	CONSTRAINT "loan_approvals_decision_chk" CHECK (decision IN ('APPROVE', 'REJECT')),
	CONSTRAINT "loan_approvals_reject_remarks_chk" CHECK ("loan_approvals"."decision" <> 'REJECT' OR coalesce(trim("loan_approvals"."remarks"), '') <> '')
);
--> statement-breakpoint
CREATE TABLE "loan_product_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"basis" text NOT NULL,
	"value" text NOT NULL,
	"gl_key" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_product_deductions_code_chk" CHECK (code IN ('SERVICE_FEE', 'CBU', 'LPP', 'NOTARIAL', 'OTHER')),
	CONSTRAINT "loan_product_deductions_basis_chk" CHECK (basis IN ('PCT_OF_PRINCIPAL', 'FIXED'))
);
--> statement-breakpoint
CREATE TABLE "loan_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"rate_pm" text NOT NULL,
	"min_term" integer NOT NULL,
	"max_term" integer NOT NULL,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"max_amount" bigint,
	"max_multiple_of_paid_up" text,
	"required_comakers" integer DEFAULT 0 NOT NULL,
	"penalty_rate_pm" text NOT NULL,
	"grace_days" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"receivable_gl_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "loan_products_code_unique" UNIQUE("code"),
	CONSTRAINT "loan_products_method_chk" CHECK (method IN ('DIMINISHING_EQUAL_AMORT', 'DIMINISHING_EQUAL_PRINCIPAL', 'ADD_ON')),
	CONSTRAINT "loan_products_terms_chk" CHECK ("loan_products"."min_term" >= 1 AND "loan_products"."max_term" >= "loan_products"."min_term"),
	CONSTRAINT "loan_products_frequency_chk" CHECK ("loan_products"."frequency" = 'MONTHLY'),
	CONSTRAINT "loan_products_amounts_chk" CHECK (("loan_products"."max_amount" IS NULL OR "loan_products"."max_amount" > 0) AND "loan_products"."required_comakers" >= 0 AND "loan_products"."grace_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "loan_application_comakers" ADD CONSTRAINT "loan_application_comakers_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_application_comakers" ADD CONSTRAINT "loan_application_comakers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_product_id_loan_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."loan_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_encoded_by_users_id_fk" FOREIGN KEY ("encoded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_approvals" ADD CONSTRAINT "loan_approvals_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_approvals" ADD CONSTRAINT "loan_approvals_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_product_deductions" ADD CONSTRAINT "loan_product_deductions_product_id_loan_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."loan_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_application_comakers_uq" ON "loan_application_comakers" USING btree ("application_id","member_id");--> statement-breakpoint
CREATE INDEX "loan_application_comakers_member_idx" ON "loan_application_comakers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "loan_applications_member_idx" ON "loan_applications" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "loan_applications_status_idx" ON "loan_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loan_approvals_application_idx" ON "loan_approvals" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "loan_product_deductions_product_idx" ON "loan_product_deductions" USING btree ("product_id");