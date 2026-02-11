import type { Request, Response, NextFunction } from "express";
import { tenantDb } from "../db/tenantDb.js";
import { unitMembers, units } from "../db/schema/tenant.js";
import { eq, inArray } from "drizzle-orm";

/** Returns true if the user has resident role in this tenant. */
export function isResident(req: Request): boolean {
  if (!req.user || !req.tenantSlug) return false;
  const role = req.user.roleByTenant[req.tenantSlug];
  return role === "resident";
}

/** Get unit IDs the user is a member of in this tenant (for residents). */
export async function getResidentUnitIds(
  tenantSlug: string,
  userId: number
): Promise<number[]> {
  const rows = await tenantDb(tenantSlug, (db) =>
    db
      .select({ unitId: unitMembers.unitId })
      .from(unitMembers)
      .where(eq(unitMembers.userId, userId))
  );
  return rows.map((r) => r.unitId);
}

/** Get building IDs for the units the user is a member of. */
export async function getResidentBuildingIds(
  tenantSlug: string,
  userId: number
): Promise<number[]> {
  const unitIds = await getResidentUnitIds(tenantSlug, userId);
  if (unitIds.length === 0) return [];
  const rows = await tenantDb(tenantSlug, (db) =>
    db.select({ buildingId: units.buildingId }).from(units).where(inArray(units.id, unitIds))
  );
  return [...new Set(rows.map((r) => r.buildingId))];
}

/** Returns true if the user is an org admin (org_owner or org_admin). */
export function isAdmin(req: Request): boolean {
  if (!req.user || !req.tenantSlug) return false;
  const role = req.user.roleByTenant[req.tenantSlug];
  return role === "org_owner" || role === "org_admin";
}

/** Require staff (non-resident). Returns 403 for residents. */
export async function requireStaff(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || !req.tenantSlug) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (isResident(req)) {
    res.status(403).json({ error: "Access denied: residents cannot access this resource" });
    return;
  }
  next();
}

/** Require org admin (org_owner or org_admin). Returns 403 for non-admins. */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || !req.tenantSlug) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Access denied: admins only" });
    return;
  }
  next();
}
