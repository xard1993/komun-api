ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logo" varchar(512);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "currency" varchar(16);
