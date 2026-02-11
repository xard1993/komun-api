import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { auditLog as auditLogTable } from "../db/schema/tenant.js";
import { desc } from "drizzle-orm";
import { getPublicUsers } from "../services/userLookup.js";

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth, requireTenant, requireAdmin);

/** GET /audit-log - list recent audit entries for the tenant (admins only) */
auditLogRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;

  const rows = await tenantDb(slug, (db) =>
    db
      .select()
      .from(auditLogTable)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit)
      .offset(offset)
  );

  const filtered =
    entityType || entityId
      ? rows.filter(
          (r) =>
            (!entityType || r.entityType === entityType) &&
            (!entityId || r.entityId === entityId)
        )
      : rows;

  const actorIds = [...new Set(filtered.map((r) => r.actorId))];
  const userMap = await getPublicUsers(actorIds);

  const list = filtered.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    details: r.details,
    createdAt: r.createdAt,
    actorId: r.actorId,
    actor: userMap[r.actorId]
      ? {
          id: userMap[r.actorId].id,
          name: userMap[r.actorId].name,
          email: userMap[r.actorId].email,
        }
      : null,
  }));

  res.json(list);
});
