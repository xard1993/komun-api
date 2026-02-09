/**
 * Applies pending tenant migrations to ALL existing tenant schemas.
 * Run this once after adding a new tenant migration (e.g. new column).
 *
 * Usage: npx tsx src/scripts/migrate-all-tenants.ts
 * Or:    npm run db:migrate-tenant-all
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/index.js";
import { publicDb } from "../db/index.js";
import { tenants } from "../db/schema/public.js";
import { tenantSchemaName } from "../db/tenantDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_MIGRATIONS_DIR = path.join(__dirname, "../../drizzle/tenant");

async function main() {
  const journalPath = path.join(TENANT_MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(
    fs.readFileSync(journalPath, "utf-8")
  ) as { entries: Array<{ tag: string }> };
  const pending = journal.entries.slice(1);
  if (pending.length === 0) {
    console.log("No pending tenant migrations.");
    process.exit(0);
  }

  const tenantRows = await publicDb.select({ slug: tenants.slug }).from(tenants);
  if (tenantRows.length === 0) {
    console.log("No tenants found.");
    process.exit(0);
  }

  for (const { slug } of tenantRows) {
    const schemaName = tenantSchemaName(slug);
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
        }
        console.log("Tenant", slug, "– ran:", entry.tag);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Tenant", slug, "failed:", err);
      client.release();
      process.exit(1);
    } finally {
      client.release();
    }
  }
  console.log("All tenants migrated.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
