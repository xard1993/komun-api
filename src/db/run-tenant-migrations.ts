import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";
import { tenantSchemaName } from "./tenantDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_MIGRATIONS_DIR = path.join(__dirname, "../../drizzle/tenant");

/**
 * Runs the tenant schema migration SQL in the given tenant schema.
 * Call this after CREATE SCHEMA when creating a new tenant.
 */
export async function runTenantMigrations(tenantSlug: string): Promise<void> {
  const schemaName = tenantSchemaName(tenantSlug);
  const journalPath = path.join(TENANT_MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(
    fs.readFileSync(journalPath, "utf-8")
  ) as { entries: Array<{ tag: string }> };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    for (const entry of journal.entries) {
      const sqlPath = path.join(TENANT_MIGRATIONS_DIR, `${entry.tag}.sql`);
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
