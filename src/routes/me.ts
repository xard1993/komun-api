import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import { unitMembers, units, buildings, unitFees } from "../db/schema/tenant.js";
import { eq, inArray, desc } from "drizzle-orm";

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

/** GET /me/fees - fees that apply to the current user's units (for residents to view "Your fees") */
meRouter.get("/fees", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;
  const myUnits = await tenantDb(slug, (db) =>
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
  if (myUnits.length === 0) {
    return res.json({ units: [] });
  }
  const unitIds = myUnits.map((u) => u.id);
  const fees = await tenantDb(slug, (db) =>
    db
      .select()
      .from(unitFees)
      .where(inArray(unitFees.unitId, unitIds))
      .orderBy(desc(unitFees.effectiveFrom))
  );
  const feesByUnit = new Map<number, typeof fees>();
  for (const f of fees) {
    const list = feesByUnit.get(f.unitId) ?? [];
    list.push(f);
    feesByUnit.set(f.unitId, list);
  }
  const unitsWithFees = myUnits.map((u) => ({
    unitId: u.id,
    identifier: u.identifier,
    buildingName: u.buildingName,
    fees: (feesByUnit.get(u.id) ?? []).map((f) => ({
      id: f.id,
      amount: f.amount,
      frequency: f.frequency,
      effectiveFrom: f.effectiveFrom,
      effectiveUntil: f.effectiveUntil,
    })),
  }));
  res.json({ units: unitsWithFees });
});
