import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool } from "./index.js";
import * as tenantSchema from "./schema/tenant.js";

const SLUG_REGEX = /^[a-z0-9_-]+$/;
const MAX_SLUG_LENGTH = 64;

export function tenantSchemaName(slug: string): string {
  if (!slug || slug.length > MAX_SLUG_LENGTH || !SLUG_REGEX.test(slug)) {
    throw new Error("Invalid tenant slug");
  }
  return `tenant_${slug}`;
}

export type TenantDb = ReturnType<typeof createTenantDb>;

function createTenantDb(client: PoolClient) {
  return drizzle(client, { schema: tenantSchema });
}

/**
 * Runs all queries inside a transaction with search_path set to the tenant schema.
 * Uses SET LOCAL so the path is only for the current transaction.
 */
export async function tenantDb<T>(
  tenantSlug: string,
  fn: (db: TenantDb) => Promise<T>
): Promise<T> {
  const schemaName = tenantSchemaName(tenantSlug);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SET LOCAL search_path TO "${schemaName}", public`
    );
    const db = createTenantDb(client);
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
