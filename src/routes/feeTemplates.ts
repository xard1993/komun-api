import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { feeTemplates as feeTemplatesTable, unitFees, units } from "../db/schema/tenant.js";
import { eq, desc, inArray } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";

export const feeTemplatesRouter = Router();
feeTemplatesRouter.use(requireAuth, requireTenant, requireStaff);

const frequencyEnum = z.enum(["monthly", "yearly"]);
const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().nonnegative(),
  frequency: frequencyEnum,
  buildingId: z.number().int().positive().nullable().optional(),
});
const createUnitFeeSchema = z.object({
  unitId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  frequency: frequencyEnum,
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().optional(),
  feeTemplateId: z.number().int().positive().nullable().optional(),
});

feeTemplatesRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const buildingIdParam = req.query.buildingId as string | undefined;
  const buildingId = buildingIdParam ? parseInt(buildingIdParam, 10) : undefined;
  const list = await tenantDb(slug, (db) => {
    if (buildingId != null && !Number.isNaN(buildingId)) {
      return db.select().from(feeTemplatesTable).where(eq(feeTemplatesTable.buildingId, buildingId));
    }
    return db.select().from(feeTemplatesTable).orderBy(desc(feeTemplatesTable.id));
  });
  res.json(list);
});

feeTemplatesRouter.post("/", async (req, res) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(feeTemplatesTable)
      .values({
        name: parsed.data!.name,
        amount: parsed.data!.amount.toFixed(2),
        frequency: parsed.data!.frequency,
        buildingId: parsed.data!.buildingId ?? null,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "fee_template", entityId: r.id, details: { name: r.name } });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(500).json({ error: "Failed to create" });
    return;
  }
  res.status(201).json(row);
});

// Unit-fees routes must be before /:id so "unit-fees" is not matched as id
feeTemplatesRouter.get("/unit-fees/list", async (req, res) => {
  const slug = req.tenantSlug!;
  const buildingIdParam = req.query.buildingId as string | undefined;
  const unitIdParam = req.query.unitId as string | undefined;
  const list = await tenantDb(slug, async (db) => {
    if (unitIdParam) {
      const unitId = parseInt(unitIdParam, 10);
      if (Number.isNaN(unitId)) return [];
      return db.select().from(unitFees).where(eq(unitFees.unitId, unitId)).orderBy(desc(unitFees.effectiveFrom));
    }
    if (buildingIdParam) {
      const buildingId = parseInt(buildingIdParam, 10);
      if (Number.isNaN(buildingId)) return db.select().from(unitFees).orderBy(desc(unitFees.id));
      const unitIds = await db.select({ id: units.id }).from(units).where(eq(units.buildingId, buildingId));
      const ids = unitIds.map((u) => u.id);
      if (ids.length === 0) return [];
      return db.select().from(unitFees).where(inArray(unitFees.unitId, ids)).orderBy(desc(unitFees.effectiveFrom));
    }
    return db.select().from(unitFees).orderBy(desc(unitFees.id));
  });
  res.json(list);
});

feeTemplatesRouter.post("/unit-fees", async (req, res) => {
  const parsed = createUnitFeeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(unitFees)
      .values({
        unitId: parsed.data!.unitId,
        amount: parsed.data!.amount.toFixed(2),
        frequency: parsed.data!.frequency,
        effectiveFrom: parsed.data!.effectiveFrom,
        effectiveUntil: parsed.data!.effectiveUntil ?? null,
        feeTemplateId: parsed.data!.feeTemplateId ?? null,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "unit_fee", entityId: r.id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(500).json({ error: "Failed to create" });
    return;
  }
  res.status(201).json(row);
});

feeTemplatesRouter.patch("/unit-fees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createUnitFeeSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const update: Record<string, unknown> = {};
  if (parsed.data?.amount != null) update.amount = parsed.data.amount.toFixed(2);
  if (parsed.data?.frequency != null) update.frequency = parsed.data.frequency;
  if (parsed.data?.effectiveFrom != null) update.effectiveFrom = parsed.data.effectiveFrom;
  if (parsed.data?.effectiveUntil !== undefined) update.effectiveUntil = parsed.data.effectiveUntil ?? null;
  if (parsed.data?.feeTemplateId !== undefined) update.feeTemplateId = parsed.data.feeTemplateId ?? null;
  if (Object.keys(update).length === 0) {
    const [existing] = await tenantDb(slug, (db) => db.select().from(unitFees).where(eq(unitFees.id, id)).limit(1));
    return existing ? res.json(existing) : res.status(404).json({ error: "Not found" });
  }
  const [row] = await tenantDb(slug, (db) => db.update(unitFees).set(update).where(eq(unitFees.id, id)).returning());
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

feeTemplatesRouter.delete("/unit-fees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [deleted] = await tenantDb(slug, (db) => db.delete(unitFees).where(eq(unitFees.id, id)).returning({ id: unitFees.id }));
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

feeTemplatesRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) => db.select().from(feeTemplatesTable).where(eq(feeTemplatesTable.id, id)).limit(1));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

feeTemplatesRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createTemplateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const update: Record<string, unknown> = {};
  if (parsed.data?.name != null) update.name = parsed.data.name;
  if (parsed.data?.amount != null) update.amount = parsed.data.amount.toFixed(2);
  if (parsed.data?.frequency != null) update.frequency = parsed.data.frequency;
  if (parsed.data?.buildingId !== undefined) update.buildingId = parsed.data.buildingId ?? null;
  if (Object.keys(update).length === 0) {
    const [existing] = await tenantDb(slug, (db) => db.select().from(feeTemplatesTable).where(eq(feeTemplatesTable.id, id)).limit(1));
    return existing ? res.json(existing) : res.status(404).json({ error: "Not found" });
  }
  const [row] = await tenantDb(slug, (db) => db.update(feeTemplatesTable).set(update).where(eq(feeTemplatesTable.id, id)).returning());
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

feeTemplatesRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [deleted] = await tenantDb(slug, async (db) => {
    const [r] = await db.delete(feeTemplatesTable).where(eq(feeTemplatesTable.id, id)).returning({ id: feeTemplatesTable.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "fee_template", entityId: id });
    return r ? [r] : [];
  });
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});
