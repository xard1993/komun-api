import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import { unitMembers, units, buildings } from "../db/schema/tenant.js";
import { eq } from "drizzle-orm";

export const meRouter = Router();
meRouter.use(requireAuth, requireTenant);

/** GET /me/units - units the current user is a member of (for residents: their unit(s); for staff: any they're in unit_members) */
meRouter.get("/units", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;
  const list = await tenantDb(slug, (db) =>
    db
      .select({
        id: units.id,
        identifier: units.identifier,
        buildingId: units.buildingId,
        buildingName: buildings.name,
      })
      .from(unitMembers)
      .innerJoin(units, eq(unitMembers.unitId, units.id))
      .innerJoin(buildings, eq(units.buildingId, buildings.id))
      .where(eq(unitMembers.userId, userId))
  );
  res.json(list);
});
