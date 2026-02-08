import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import { buildings as buildingsTable, units as unitsTable } from "../db/schema/tenant.js";
import { eq } from "drizzle-orm";

export const buildingsRouter = Router();
buildingsRouter.use(requireAuth, requireTenant);

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
  const list = await tenantDb(slug, (db) =>
    db.select().from(unitsTable).where(eq(unitsTable.buildingId, buildingId))
  );
  res.json(list);
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
