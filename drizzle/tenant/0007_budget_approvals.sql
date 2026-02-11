ALTER TABLE "budget_periods" ADD COLUMN IF NOT EXISTS "sent_for_approval_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_period_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"token" varchar(64) NOT NULL UNIQUE,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" integer,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_approvals" ADD CONSTRAINT "budget_approvals_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_approvals" ADD CONSTRAINT "budget_approvals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
