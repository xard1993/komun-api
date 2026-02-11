DO $$ BEGIN
 CREATE TYPE "budget_line_category" AS ENUM('one_time', 'recurring', 'extras');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "budget_status" AS ENUM('draft', 'proposed', 'approved', 'closed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "fee_frequency" AS ENUM('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "building_financials" (
	"building_id" integer PRIMARY KEY NOT NULL,
	"current_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "building_financials" ADD CONSTRAINT "building_financials_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"unit_id" integer,
	"budget_period_id" integer,
	"description" varchar(512),
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"year" integer NOT NULL,
	"opening_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_period_id" integer NOT NULL,
	"category" "budget_line_category" NOT NULL,
	"description" varchar(512) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_missing_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_period_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_missing_payments" ADD CONSTRAINT "budget_missing_payments_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_missing_payments" ADD CONSTRAINT "budget_missing_payments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_unit_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_period_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_unit_contributions" ADD CONSTRAINT "budget_unit_contributions_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_unit_contributions" ADD CONSTRAINT "budget_unit_contributions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" "fee_frequency" NOT NULL,
	"building_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fee_templates" ADD CONSTRAINT "fee_templates_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"fee_template_id" integer,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" "fee_frequency" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit_fees" ADD CONSTRAINT "unit_fees_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit_fees" ADD CONSTRAINT "unit_fees_fee_template_id_fee_templates_id_fk" FOREIGN KEY ("fee_template_id") REFERENCES "fee_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
