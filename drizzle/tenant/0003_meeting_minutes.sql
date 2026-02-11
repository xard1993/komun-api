CREATE TABLE IF NOT EXISTS "meeting_minutes" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"meeting_date" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

