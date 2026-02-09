/**
 * Applies pending tenant migrations to an existing tenant schema.
 * Use when you've added new migrations (e.g. 0001_announcements_building_id)
 * after the tenant was already created.
 *
 * Usage: npx tsx src/scripts/migrate-tenant-existing.ts <tenantSlug>
 * Example: npx tsx src/scripts/migrate-tenant-existing.ts demo
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/index.js";
import { tenantSchemaName } from "../db/tenantDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_MIGRATIONS_DIR = path.join(__dirname, "../../drizzle/tenant");

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx src/scripts/migrate-tenant-existing.ts <tenantSlug>");
    process.exit(1);
  }
  const schemaName = tenantSchemaName(slug);
  const journalPath = path.join(TENANT_MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(
    fs.readFileSync(journalPath, "utf-8")
  ) as { entries: Array<{ tag: string }> };
  // Skip 0000 (initial) - only run later migrations that add columns etc.
  const pending = journal.entries.slice(1);
  if (pending.length === 0) {
    console.log("No pending tenant migrations.");
    process.exit(0);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    for (const entry of pending) {
      const sqlPath = path.join(TENANT_MIGRATIONS_DIR, `${entry.tag}.sql`);
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
        console.log("Ran:", entry.tag);
      }
    }
    await client.query("COMMIT");
    console.log(`Tenant "${slug}" migrations complete.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
