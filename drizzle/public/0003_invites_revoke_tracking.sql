ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;
ALTER TABLE "invites" ADD COLUMN "revoked_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

