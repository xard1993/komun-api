ALTER TABLE "invites" ADD COLUMN "accepted_at" timestamp with time zone;
ALTER TABLE "invites" ADD COLUMN "accepted_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

