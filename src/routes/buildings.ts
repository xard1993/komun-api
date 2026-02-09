import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import { buildings as buildingsTable, units as unitsTable, unitMembers } from "../db/schema/tenant.js";
import { eq, inArray } from "drizzle-orm";

export const buildingsRouter = Router();
buildingsRouter.use(requireAuth, requireTenant, requireStaff);

const createBuildingSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
});
const updateBuildingSchema = createBuildingSchema.partial();

buildingsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) => db.select().from(buildingsTable));
  res.json(list);
});

buildingsRouter.post("/", async (req, res) => {
  const parsed = createBuildingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.insert(buildingsTable).values(parsed.data).returning()
  );
  res.status(201).json(row);
});

buildingsRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.select().from(buildingsTable).where(eq(buildingsTable.id, id)).limit(1)
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

buildingsRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateBuildingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.update(buildingsTable).set(parsed.data).where(eq(buildingsTable.id, id)).returning()
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

buildingsRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.delete(buildingsTable).where(eq(buildingsTable.id, id)).returning({ id: buildingsTable.id })
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

const createUnitSchema = z.object({ identifier: z.string().min(1).max(64) });

buildingsRouter.get("/:id/units", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const withMembers = req.query.includeMembers === "true";
  const units = await tenantDb(slug, (db) =>
    db.select().from(unitsTable).where(eq(unitsTable.buildingId, buildingId))
  );
  if (!withMembers || units.length === 0) {
    res.json(units);
    return;
  }
  const unitIds = units.map((u) => u.id);
  const allMembers = await tenantDb(slug, (db) =>
    db.select().from(unitMembers).where(inArray(unitMembers.unitId, unitIds))
  );
  const userIds = [...new Set(allMembers.map((m) => m.userId))];
  const userRows =
    userIds.length > 0
      ? await publicDb.select({ id: users.id, email: users.email, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [];
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]));
  const membersByUnit: Record<number, Array<{ userId: number; email: string; name: string | null; role: string }>> = {};
  for (const u of units) membersByUnit[u.id] = [];
  for (const m of allMembers) {
    membersByUnit[m.unitId]?.push({
      userId: m.userId,
      email: userMap[m.userId]?.email ?? "",
      name: userMap[m.userId]?.name ?? null,
      role: m.role,
    });
  }
  res.json(
    units.map((u) => ({
      ...u,
      members: membersByUnit[u.id] ?? [],
    }))
  );
});

buildingsRouter.post("/:id/units", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [building] = await tenantDb(slug, (db) =>
    db.select().from(buildingsTable).where(eq(buildingsTable.id, buildingId)).limit(1)
  );
  if (!building) {
    res.status(404).json({ error: "Building not found" });
    return;
  }
  const [row] = await tenantDb(slug, (db) =>
    db.insert(unitsTable).values({ buildingId, identifier: parsed.data.identifier }).returning()
  );
  res.status(201).json(row);
});
