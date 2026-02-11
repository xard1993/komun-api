import type { TenantDb } from "../db/tenantDb.js";
import { auditLog } from "../db/schema/tenant.js";

export type AuditAction = "create" | "update" | "delete" | "send_for_approval";

export interface AuditParams {
  actorId: number;
  action: AuditAction;
  entityType: string;
  entityId?: string | number;
  details?: Record<string, unknown>;
}

/**
 * Write an audit log entry. Must be called inside a tenantDb callback so it runs
 * in the same transaction and tenant schema.
 */
export async function logAudit(db: TenantDb, params: AuditParams): Promise<void> {
  await db.insert(auditLog).values({
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId != null ? String(params.entityId) : null,
    details: params.details ?? null,
  });
}
