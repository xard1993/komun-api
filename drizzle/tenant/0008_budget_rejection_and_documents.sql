ALTER TABLE "budget_approvals" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "budget_approvals" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_period_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_period_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_period_documents" ADD CONSTRAINT "budget_period_documents_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_period_documents" ADD CONSTRAINT "budget_period_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
