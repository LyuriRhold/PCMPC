ALTER TABLE "water_rate_schedules" DROP CONSTRAINT "water_rate_schedules_version_uq";--> statement-breakpoint
ALTER TABLE "water_rate_schedules" ADD COLUMN "applies_to" text DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "water_rate_schedules" ADD CONSTRAINT "water_rate_schedules_version_uq" UNIQUE("classification","applies_to","effective_from");--> statement-breakpoint
ALTER TABLE "water_rate_schedules" ADD CONSTRAINT "water_rate_schedules_applies_chk" CHECK (applies_to IN ('ALL', 'MEMBER', 'NON_MEMBER'));