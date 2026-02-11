/**
 * One-off: add revoked_at and revoked_user_id to invites if missing.
 * Run with: npx tsx src/scripts/add-invites-revoke-columns.ts
 */
import "dotenv/config";
import { pool } from "../db/index.js";

async function main() {
  await pool.query(`
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone;
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS revoked_user_id integer REFERENCES users(id) ON DELETE SET NULL;
  `);
  console.log("invites.revoked_at and invites.revoked_user_id added (or already exist).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
