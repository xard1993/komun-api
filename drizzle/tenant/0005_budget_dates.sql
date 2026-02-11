-- Budget period start/end dates (yearly by default)
ALTER TABLE "budget_periods" ADD COLUMN IF NOT EXISTS "start_date" date;
ALTER TABLE "budget_periods" ADD COLUMN IF NOT EXISTS "end_date" date;
UPDATE "budget_periods" SET "start_date" = (year::text || '-01-01')::date, "end_date" = (year::text || '-12-31')::date WHERE "start_date" IS NULL OR "end_date" IS NULL;
