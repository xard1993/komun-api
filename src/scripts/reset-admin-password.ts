/**
 * Resets the seed admin user password to password123.
 * Use when you've changed the password and can't log in.
 *
 * Usage: npx tsx src/scripts/reset-admin-password.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import { eq } from "drizzle-orm";

const SEED_EMAIL = "admin@test.com";
const SEED_PASSWORD = "password123";

async function main() {
  const [user] = await publicDb
    .select()
    .from(users)
    .where(eq(users.email, SEED_EMAIL))
    .limit(1);
  if (!user) {
    console.error("User not found:", SEED_EMAIL, "- run npm run db:seed first");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  await publicDb.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  console.log("Password reset for", SEED_EMAIL);
  console.log("You can now sign in with:", SEED_EMAIL, "/", SEED_PASSWORD);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
