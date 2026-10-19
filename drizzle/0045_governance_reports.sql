CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"position" text NOT NULL,
	"committee" text NOT NULL,
	"term_start" date NOT NULL,
	"term_end" date,
	"elected_at_ga" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "officers_committee_chk" CHECK (committee IN ('BOARD', 'AUDIT', 'ELECTION', 'MEDIATION_CONCILIATION', 'ETHICS', 'CREDIT', 'EDUCATION_TRAINING', 'GENDER_DEVELOPMENT', 'MANAGEMENT')),
	CONSTRAINT "officers_term_chk" CHECK ("officers"."term_end" IS NULL OR "officers"."term_end" >= "officers"."term_start")
);
--> statement-breakpoint
CREATE TABLE "training_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "training_attendees_uq" UNIQUE("training_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"held_on" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "trainings_hours_chk" CHECK ("trainings"."hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report" text NOT NULL,
	"params" jsonb NOT NULL,
	"generated_by" uuid,
	"file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendees" ADD CONSTRAINT "training_attendees_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "officers_member_idx" ON "officers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "trainings_held_idx" ON "trainings" USING btree ("held_on");--> statement-breakpoint
CREATE INDEX "report_runs_report_idx" ON "report_runs" USING btree ("report");