import "dotenv/config";
import bcrypt from "bcryptjs";
import { publicDb } from "../db/index.js";
import { users, tenants, tenantUsers } from "../db/schema/public.js";
import { eq } from "drizzle-orm";
import { createTenant } from "../services/tenantService.js";

const SEED_EMAIL = "admin@test.com";
const SEED_PASSWORD = "password123";
const SEED_TENANT_NAME = "Demo Condo";
const SEED_TENANT_SLUG = "demo";

async function main() {
  const existing = await publicDb.select().from(users).where(eq(users.email, SEED_EMAIL)).limit(1);
  let userId: number;
  if (existing.length > 0) {
    userId = existing[0].id;
    console.log("Seed user already exists:", SEED_EMAIL);
  } else {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const [user] = await publicDb
      .insert(users)
      .values({
        email: SEED_EMAIL,
        passwordHash,
        name: "Admin",
      })
      .returning();
    userId = user!.id;
    console.log("Created user:", SEED_EMAIL);
  }

  const existingTenant = await publicDb.select().from(tenants).where(eq(tenants.slug, SEED_TENANT_SLUG)).limit(1);
  if (existingTenant.length > 0) {
    console.log("Seed tenant already exists:", SEED_TENANT_SLUG);
  } else {
    await createTenant(SEED_TENANT_NAME, SEED_TENANT_SLUG, userId);
    console.log("Created tenant:", SEED_TENANT_NAME, "(" + SEED_TENANT_SLUG + ")");
  }

  console.log("\nSeed complete. Sign in with:", SEED_EMAIL, "/", SEED_PASSWORD);
  console.log("Then open /t/demo/dashboard");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
