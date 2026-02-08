import "dotenv/config";
import { pool } from "../db/index.js";
import { createTenant } from "../services/tenantService.js";

const [name, slug, ownerEmail] = process.argv.slice(2);
if (!name || !slug || !ownerEmail) {
  console.error("Usage: npm run db:create-tenant -- <name> <slug> <owner-email>");
  process.exit(1);
}

async function main() {
  const userResult = await pool.query(
    "SELECT id FROM public.users WHERE email = $1",
    [ownerEmail]
  );
  if (userResult.rows.length === 0) {
    console.error("User not found:", ownerEmail);
    process.exit(1);
  }
  const ownerUserId = userResult.rows[0].id;
  const tenant = await createTenant(name, slug, ownerUserId);
  console.log("Tenant created:", tenant);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
