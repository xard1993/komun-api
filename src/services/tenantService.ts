import { pool } from "../db/index.js";
import { runTenantMigrations } from "../db/run-tenant-migrations.js";
import { tenantSchemaName } from "../db/tenantDb.js";

export async function createTenant(
  name: string,
  slug: string,
  ownerUserId: number
): Promise<{ id: number; slug: string; name: string }> {
  const schemaName = tenantSchemaName(slug);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertResult = await client.query(
      `INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, name`,
      [slug, name]
    );
    const row = insertResult.rows[0];
    const tenantId = row.id;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await client.query("COMMIT");
    client.release();
    await runTenantMigrations(slug);
    await pool.query(
      `INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'org_owner')`,
      [tenantId, ownerUserId]
    );
    return { id: tenantId, slug: row.slug, name: row.name };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    throw err;
  }
}
