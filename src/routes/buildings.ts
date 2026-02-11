import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff, isResident, getResidentBuildingIds, getResidentUnitIds } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import {
  buildings as buildingsTable,
  units as unitsTable,
  unitMembers,
  buildingFinancials,
  financialTransactions,
  budgetPeriods,
} from "../db/schema/tenant.js";
import { eq, inArray, desc } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";

export const buildingsRouter = Router();
buildingsRouter.use(requireAuth, requireTenant);

const createBuildingSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
});
const updateBuildingSchema = createBuildingSchema.partial();

buildingsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (buildingIds.length === 0) return res.json([]);
    const list = await tenantDb(slug, (db) =>
      db.select().from(buildingsTable).where(inArray(buildingsTable.id, buildingIds))
    );
    return res.json(list);
  }
  const list = await tenantDb(slug, (db) => db.select().from(buildingsTable));
  res.json(list);
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
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  res.json(row);
});

buildingsRouter.get("/:id/units", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const residentUnitIds = await getResidentUnitIds(slug, req.user!.userId);
    const units = await tenantDb(slug, (db) =>
      db.select().from(unitsTable).where(eq(unitsTable.buildingId, buildingId))
    );
    const filtered = units.filter((u) => residentUnitIds.includes(u.id));
    const withMembers = req.query.includeMembers === "true";
    if (!withMembers || filtered.length === 0) {
      return res.json(filtered);
    }
    const unitIds = filtered.map((u) => u.id);
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
    for (const u of filtered) membersByUnit[u.id] = [];
    for (const m of allMembers) {
      membersByUnit[m.unitId]?.push({
        userId: m.userId,
        email: userMap[m.userId]?.email ?? "",
        name: userMap[m.userId]?.name ?? null,
        role: m.role,
      });
    }
    return res.json(
      filtered.map((u) => ({
        ...u,
        members: membersByUnit[u.id] ?? [],
      }))
    );
  }
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

buildingsRouter.get("/:id/financials", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const [building] = await tenantDb(slug, (db) =>
    db.select().from(buildingsTable).where(eq(buildingsTable.id, buildingId)).limit(1)
  );
  if (!building) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [fin] = await tenantDb(slug, (db) =>
    db.select().from(buildingFinancials).where(eq(buildingFinancials.buildingId, buildingId)).limit(1)
  );
  if (!fin) {
    const [inserted] = await tenantDb(slug, (db) =>
      db.insert(buildingFinancials).values({ buildingId, currentBalance: "0" }).returning()
    );
    return res.json(inserted ?? { buildingId, currentBalance: "0", updatedAt: new Date() });
  }
  res.json(fin);
});

buildingsRouter.get("/:id/transactions", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const list = await tenantDb(slug, (db) =>
    db.select().from(financialTransactions).where(eq(financialTransactions.buildingId, buildingId)).orderBy(desc(financialTransactions.createdAt))
  );
  res.json(list);
});

buildingsRouter.use(requireStaff);

buildingsRouter.post("/", async (req, res) => {
  const parsed = createBuildingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.insert(buildingsTable).values(parsed.data).returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "building", entityId: r.id, details: { name: r.name } });
    return r ? [r] : [];
  });
  res.status(201).json(row);
});

const createTransactionSchema = z.object({
  unitId: z.number().int().positive(),
  budgetPeriodId: z.number().int().positive().optional(),
  amount: z.number().positive(),
  description: z.string().max(512).optional(),
});

buildingsRouter.post("/:id/transactions", async (req, res) => {
  const buildingId = parseInt(req.params.id, 10);
  if (Number.isNaN(buildingId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  if (parsed.data.budgetPeriodId != null) {
    const [period] = await tenantDb(slug, (db) =>
      db.select({ status: budgetPeriods.status }).from(budgetPeriods).where(eq(budgetPeriods.id, parsed.data!.budgetPeriodId!)).limit(1)
    );
    if (!period || period.status !== "approved") {
      res.status(400).json({ error: "Budget must be approved before recording payments." });
      return;
    }
  }
  const amountStr = parsed.data.amount.toFixed(2);
  const [tx] = await tenantDb(slug, async (db) => {
    await db.insert(financialTransactions).values({
      buildingId,
      unitId: parsed.data.unitId,
      budgetPeriodId: parsed.data.budgetPeriodId ?? null,
      amount: amountStr,
      description: parsed.data.description ?? null,
      createdBy: actorId,
    });
    const [row] = await db.select().from(financialTransactions).orderBy(desc(financialTransactions.id)).limit(1);
    if (!row) return [];
    const [fin] = await db.select().from(buildingFinancials).where(eq(buildingFinancials.buildingId, buildingId)).limit(1);
    const current = fin ? parseFloat(String(fin.currentBalance)) : 0;
    const newBalance = (current + parsed.data.amount).toFixed(2);
    if (fin) {
      await db.update(buildingFinancials).set({ currentBalance: newBalance, updatedAt: new Date() }).where(eq(buildingFinancials.buildingId, buildingId));
    } else {
      await db.insert(buildingFinancials).values({ buildingId, currentBalance: newBalance });
    }
    return [row];
  });
  if (!tx) {
    res.status(500).json({ error: "Failed to create transaction" });
    return;
  }
  res.status(201).json(tx);
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
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.update(buildingsTable).set(parsed.data).where(eq(buildingsTable.id, id)).returning();
    if (r) await logAudit(db, { actorId, action: "update", entityType: "building", entityId: id, details: parsed.data });
    return r ? [r] : [];
  });
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
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.delete(buildingsTable).where(eq(buildingsTable.id, id)).returning({ id: buildingsTable.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "building", entityId: id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

const createUnitSchema = z.object({ identifier: z.string().min(1).max(64) });

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
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.insert(unitsTable).values({ buildingId, identifier: parsed.data.identifier }).returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "unit", entityId: r.id, details: { identifier: r.identifier, buildingId } });
    return r ? [r] : [];
  });
  res.status(201).json(row);
});
