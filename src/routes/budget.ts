import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff, isResident, getResidentBuildingIds } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  budgetPeriods,
  budgetLines,
  budgetMissingPayments,
  budgetUnitContributions,
  budgetApprovals,
  budgetPeriodDocuments,
  buildingFinancials,
  financialTransactions,
  units,
  buildings,
  feeTemplates,
  unitMembers,
  documents as documentsTable,
} from "../db/schema/tenant.js";
import { eq, and, desc, or, isNull, lt, sql, inArray } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";
import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import { sendBudgetApprovalEmail } from "../services/notify.js";
import crypto from "crypto";

export const budgetRouter = Router();
budgetRouter.use(requireAuth, requireTenant);

const categoryEnum = z.enum(["one_time", "recurring", "extras"]);
const statusEnum = z.enum(["draft", "proposed", "approved", "closed"]);

const createPeriodSchema = z.object({
  buildingId: z.number().int().positive(),
  name: z.string().min(1).max(255),
  year: z.number().int().min(2000).max(2100),
});
const updatePeriodSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  year: z.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  openingBalance: z.string().optional(),
  status: statusEnum.optional(),
});
const createLineSchema = z.object({
  category: categoryEnum,
  description: z.string().min(1).max(512),
  amount: z.number().nonnegative(),
  sortOrder: z.number().int().optional(),
});
const createMissingPaymentSchema = z.object({
  unitId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  reason: z.string().max(512).optional(),
});
const createContributionSchema = z.object({ unitId: z.number().int().positive(), amount: z.number().nonnegative() });

budgetRouter.get("/periods", async (req, res) => {
  const slug = req.tenantSlug!;
  const buildingIdParam = req.query.buildingId as string | undefined;
  const buildingId = buildingIdParam ? parseInt(buildingIdParam, 10) : undefined;
  let allowedBuildingIds: number[] | null = null;
  if (isResident(req)) {
    allowedBuildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (allowedBuildingIds.length === 0) return res.json([]);
    if (buildingId != null && !Number.isNaN(buildingId) && !allowedBuildingIds.includes(buildingId)) {
      return res.status(403).json({ error: "Access denied to this building" });
    }
  }
  const list = await tenantDb(slug, (db) => {
    if (buildingId != null && !Number.isNaN(buildingId)) {
      const condition = allowedBuildingIds
        ? and(eq(budgetPeriods.buildingId, buildingId), inArray(budgetPeriods.buildingId, allowedBuildingIds))
        : eq(budgetPeriods.buildingId, buildingId);
      return db.select().from(budgetPeriods).where(condition).orderBy(desc(budgetPeriods.year), desc(budgetPeriods.createdAt));
    }
    if (allowedBuildingIds) {
      return db.select().from(budgetPeriods).where(inArray(budgetPeriods.buildingId, allowedBuildingIds)).orderBy(desc(budgetPeriods.year), desc(budgetPeriods.createdAt));
    }
    return db.select().from(budgetPeriods).orderBy(desc(budgetPeriods.year), desc(budgetPeriods.createdAt));
  });
  const periodIds = list.map((p) => p.id);
  if (periodIds.length === 0) return res.json(list);
  const buildingsList = await tenantDb(slug, (db) => db.select().from(buildings));
  const buildingMap = Object.fromEntries(buildingsList.map((b) => [b.id, b]));
  res.json(
    list.map((p) => ({
      ...p,
      buildingName: buildingMap[p.buildingId]?.name ?? null,
    }))
  );
});

budgetRouter.get("/periods/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [period] = await tenantDb(slug, (db) => db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).limit(1));
  if (!period) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(period.buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const lines = await tenantDb(slug, (db) => db.select().from(budgetLines).where(eq(budgetLines.budgetPeriodId, id)).orderBy(budgetLines.sortOrder, budgetLines.id));
  const missing = await tenantDb(slug, (db) => db.select().from(budgetMissingPayments).where(eq(budgetMissingPayments.budgetPeriodId, id)));
  const contributions = await tenantDb(slug, (db) => db.select().from(budgetUnitContributions).where(eq(budgetUnitContributions.budgetPeriodId, id)));
  const unitsList = await tenantDb(slug, (db) => db.select().from(units).where(eq(units.buildingId, period.buildingId)));
  const transactionsForPeriod = await tenantDb(slug, async (db) =>
    db
      .select({ unitId: financialTransactions.unitId, amount: financialTransactions.amount })
      .from(financialTransactions)
      .where(eq(financialTransactions.budgetPeriodId, id))
  );
  const totalPaidByUnit: Record<number, number> = {};
  for (const t of transactionsForPeriod as { unitId: number | null; amount: string }[]) {
    if (t.unitId == null) continue;
    const amt = parseFloat(t.amount);
    totalPaidByUnit[t.unitId] = (totalPaidByUnit[t.unitId] ?? 0) + amt;
  }
  const total = lines.reduce((sum, l) => sum + parseFloat(String(l.amount)), 0);
  const contributionByUnit = Object.fromEntries(contributions.map((c) => [c.unitId, parseFloat(String(c.amount))]));
  const missingByUnit: Record<number, number> = {};
  for (const m of missing as { unitId: number; amount: string }[]) {
    missingByUnit[m.unitId] = (missingByUnit[m.unitId] ?? 0) + parseFloat(String(m.amount));
  }
  const unitsWithMeta = unitsList.map((u) => {
    const contribution = contributionByUnit[u.id] ?? 0;
    const totalPaid = totalPaidByUnit[u.id] ?? 0;
    const paid = totalPaid >= contribution && contribution > 0;
    return {
      ...u,
      contribution: contributionByUnit[u.id],
      missingPayment: missingByUnit[u.id],
      totalPaid,
      paid,
    };
  });
  const approvedCountResult = await tenantDb(slug, (db) =>
    db
      .select({ count: sql<number>`count(distinct ${budgetApprovals.unitId})` })
      .from(budgetApprovals)
      .where(and(eq(budgetApprovals.budgetPeriodId, id), sql`${budgetApprovals.approvedAt} is not null`))
  );
  const approvedUnitCount = Number(approvedCountResult[0]?.count ?? 0);
  const unitCount = unitsList.length;
  const requiredApprovalCount = Math.ceil((2 / 3) * unitCount);
  const periodDocuments = await tenantDb(slug, (db) =>
    db
      .select({ id: documentsTable.id, title: documentsTable.title, filename: documentsTable.filename })
      .from(budgetPeriodDocuments)
      .innerJoin(documentsTable, eq(budgetPeriodDocuments.documentId, documentsTable.id))
      .where(eq(budgetPeriodDocuments.budgetPeriodId, id))
  );
  res.json({
    ...period,
    lines,
    missingPayments: missing,
    contributions,
    units: unitsWithMeta,
    total: Math.round(total * 100) / 100,
    unitCount,
    approvalStats: {
      approvedUnitCount,
      requiredApprovalCount,
      unitCount,
    },
    documents: periodDocuments,
  });
});

budgetRouter.use(requireStaff);

budgetRouter.post("/periods", async (req, res) => {
  const parsed = createPeriodSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const bid = parsed.data!.buildingId;
  const year = parsed.data!.year;
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const [period] = await tenantDb(slug, async (db) => {
    const [fin] = await db.select().from(buildingFinancials).where(eq(buildingFinancials.buildingId, bid)).limit(1);
    const openingBalance = fin ? String(fin.currentBalance) : "0";
    if (!fin) {
      await db.insert(buildingFinancials).values({ buildingId: bid, currentBalance: "0" });
    }
    const [r] = await db
      .insert(budgetPeriods)
      .values({
        buildingId: bid,
        name: parsed.data!.name,
        year,
        startDate,
        endDate,
        openingBalance,
        createdBy: actorId,
      })
      .returning();
    if (!r) return [];
    await logAudit(db, { actorId, action: "create", entityType: "budget_period", entityId: r.id, details: { name: r.name } });

    // Apply fee templates for this building immediately: per-unit contribution = sum of template amounts (yearly = amount, monthly = amount*12)
    const buildingUnits = await db.select({ id: units.id }).from(units).where(eq(units.buildingId, bid));
    const templatesList = await db
      .select()
      .from(feeTemplates)
      .where(or(eq(feeTemplates.buildingId, bid), isNull(feeTemplates.buildingId)));
    let yearlyTotalPerUnit = 0;
    for (const t of templatesList) {
      const amt = parseFloat(String(t.amount));
      yearlyTotalPerUnit += t.frequency === "yearly" ? amt : amt * 12;
    }
    const contributionAmount = yearlyTotalPerUnit.toFixed(2);
    const totalContributions = (yearlyTotalPerUnit * buildingUnits.length).toFixed(2);
    for (const u of buildingUnits) {
      await db.insert(budgetUnitContributions).values({
        budgetPeriodId: r.id,
        unitId: u.id,
        amount: contributionAmount,
      });
    }

    // Add "Unit contributions" as a budget line (income from fees)
    await db.insert(budgetLines).values({
      budgetPeriodId: r.id,
      category: "recurring",
      description: "Unit contributions",
      amount: totalContributions,
      sortOrder: -1,
    });

    // Copy recurring lines from the previous year's budget for this building
    const [prevPeriod] = await db
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.buildingId, bid), lt(budgetPeriods.year, year)))
      .orderBy(desc(budgetPeriods.year))
      .limit(1);
    if (prevPeriod) {
      const recurringLines = await db
        .select()
        .from(budgetLines)
        .where(and(eq(budgetLines.budgetPeriodId, prevPeriod.id), eq(budgetLines.category, "recurring")));
      let sortOrder = 0;
      for (const line of recurringLines) {
        if (line.description === "Unit contributions") continue;
        await db.insert(budgetLines).values({
          budgetPeriodId: r.id,
          category: "recurring",
          description: line.description,
          amount: line.amount,
          sortOrder: sortOrder++,
        });
      }
    }
    return [r];
  });
  if (!period) {
    res.status(500).json({ error: "Failed to create budget period" });
    return;
  }
  res.status(201).json(period);
});

budgetRouter.post("/periods/:id/send-for-approval", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [period] = await tenantDb(slug, (db) => db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).limit(1));
  if (!period) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (period.status !== "draft") {
    res.status(400).json({ error: "Budget can only be sent for approval when status is draft" });
    return;
  }
  const unitsList = await tenantDb(slug, (db) => db.select().from(units).where(eq(units.buildingId, period.buildingId)));
  const contributions = await tenantDb(slug, (db) =>
    db.select().from(budgetUnitContributions).where(eq(budgetUnitContributions.budgetPeriodId, id))
  );
  const contributionByUnit = Object.fromEntries(contributions.map((c) => [c.unitId, parseFloat(String(c.amount))]));
  const lines = await tenantDb(slug, (db) =>
    db.select().from(budgetLines).where(eq(budgetLines.budgetPeriodId, id)).orderBy(budgetLines.sortOrder, budgetLines.id)
  );
  const total = lines.reduce((sum, l) => sum + parseFloat(String(l.amount)), 0);
  const sharePerUnitDefault = unitsList.length ? (total / unitsList.length).toFixed(2) : "0";
  const [building] = await tenantDb(slug, (db) => db.select().from(buildings).where(eq(buildings.id, period.buildingId)).limit(1));
  await tenantDb(slug, async (db) => {
    const existing = await db.select().from(budgetApprovals).where(eq(budgetApprovals.budgetPeriodId, id));
    if (existing.length > 0) {
      return;
    }
    for (const u of unitsList) {
      const token = crypto.randomBytes(32).toString("hex");
      await db.insert(budgetApprovals).values({
        budgetPeriodId: id,
        unitId: u.id,
        token,
      });
    }
    await db
      .update(budgetPeriods)
      .set({ status: "proposed", sentForApprovalAt: new Date() })
      .where(eq(budgetPeriods.id, id));
  });
  const approvalsWithToken = await tenantDb(slug, (db) =>
    db.select({ unitId: budgetApprovals.unitId, token: budgetApprovals.token }).from(budgetApprovals).where(eq(budgetApprovals.budgetPeriodId, id))
  );
  const tokenByUnit = Object.fromEntries(approvalsWithToken.map((a) => [a.unitId, a.token]));
  for (const u of unitsList) {
    const token = tokenByUnit[u.id];
    if (!token) continue;
    const sharePerUnit = (contributionByUnit[u.id] ?? sharePerUnitDefault).toFixed(2);
    const members = await tenantDb(slug, (db) =>
      db.select({ userId: unitMembers.userId }).from(unitMembers).where(eq(unitMembers.unitId, u.id))
    );
    const userIds = members.map((m) => m.userId);
    const recipientList =
      userIds.length === 0
        ? []
        : await publicDb
            .select({ email: users.email, name: users.name })
            .from(users)
            .where(inArray(users.id, userIds));
    if (recipientList.length === 0) {
      continue;
    }
    for (const r of recipientList) {
      await sendBudgetApprovalEmail({
        email: r.email,
        name: r.name,
        unitIdentifier: u.identifier ?? `Unit ${u.id}`,
        token,
        tenantSlug: slug,
        periodId: id,
        periodName: period.name,
        year: period.year,
        sharePerUnit,
      });
    }
  }
  const actorId = req.user!.userId;
  await tenantDb(slug, (db) => logAudit(db, { actorId, action: "send_for_approval", entityType: "budget_period", entityId: id, details: {} }));
  res.json({ ok: true, message: "Sent for approval", unitCount: unitsList.length });
});

budgetRouter.patch("/periods/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updatePeriodSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data?.status === "approved" && update.approvedAt === undefined) {
    update.approvedAt = new Date();
  }
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.update(budgetPeriods).set(update).where(eq(budgetPeriods.id, id)).returning();
    if (r) await logAudit(db, { actorId, action: "update", entityType: "budget_period", entityId: id, details: update });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

budgetRouter.delete("/periods/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  await tenantDb(slug, async (db) => {
    await db.update(financialTransactions).set({ budgetPeriodId: null }).where(eq(financialTransactions.budgetPeriodId, id));
    const [r] = await db.delete(budgetPeriods).where(eq(budgetPeriods.id, id)).returning({ id: budgetPeriods.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "budget_period", entityId: id });
  });
  res.status(204).send();
});

budgetRouter.get("/periods/:id/documents", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) =>
    db
      .select({ id: documentsTable.id, title: documentsTable.title, filename: documentsTable.filename, createdAt: documentsTable.createdAt })
      .from(budgetPeriodDocuments)
      .innerJoin(documentsTable, eq(budgetPeriodDocuments.documentId, documentsTable.id))
      .where(eq(budgetPeriodDocuments.budgetPeriodId, id))
  );
  res.json(list);
});

budgetRouter.post("/periods/:id/documents", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const documentId = typeof req.body?.documentId === "number" ? req.body.documentId : parseInt(String(req.body?.documentId ?? ""), 10);
  if (Number.isNaN(id) || Number.isNaN(documentId)) {
    res.status(400).json({ error: "Invalid id or documentId" });
    return;
  }
  const slug = req.tenantSlug!;
  const [period] = await tenantDb(slug, (db) => db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).limit(1));
  if (!period) {
    res.status(404).json({ error: "Budget period not found" });
    return;
  }
  const [doc] = await tenantDb(slug, (db) => db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.buildingId != null && doc.buildingId !== period.buildingId) {
    res.status(400).json({ error: "Document must belong to the same building as the budget" });
    return;
  }
  const [existing] = await tenantDb(slug, (db) =>
    db.select().from(budgetPeriodDocuments).where(and(eq(budgetPeriodDocuments.budgetPeriodId, id), eq(budgetPeriodDocuments.documentId, documentId))).limit(1)
  );
  if (existing) {
    res.status(200).json({ id: existing.id, budgetPeriodId: id, documentId });
    return;
  }
  const [row] = await tenantDb(slug, (db) =>
    db.insert(budgetPeriodDocuments).values({ budgetPeriodId: id, documentId }).returning()
  );
  res.status(201).json(row);
});

budgetRouter.delete("/periods/:periodId/documents/:documentId", async (req, res) => {
  const periodId = parseInt(req.params.periodId, 10);
  const documentId = parseInt(req.params.documentId, 10);
  if (Number.isNaN(periodId) || Number.isNaN(documentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  await tenantDb(slug, (db) =>
    db.delete(budgetPeriodDocuments).where(and(eq(budgetPeriodDocuments.budgetPeriodId, periodId), eq(budgetPeriodDocuments.documentId, documentId)))
  );
  res.status(204).send();
});

budgetRouter.get("/periods/:id/lines", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) => db.select().from(budgetLines).where(eq(budgetLines.budgetPeriodId, id)).orderBy(budgetLines.sortOrder, budgetLines.id));
  res.json(list);
});

budgetRouter.post("/periods/:id/lines", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createLineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(budgetLines)
      .values({
        budgetPeriodId: id,
        category: parsed.data!.category,
        description: parsed.data!.description,
        amount: parsed.data!.amount.toFixed(2),
        sortOrder: parsed.data!.sortOrder ?? 0,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "budget_line", entityId: r.id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(500).json({ error: "Failed to create line" });
    return;
  }
  res.status(201).json(row);
});

budgetRouter.patch("/periods/:periodId/lines/:lineId", async (req, res) => {
  const periodId = parseInt(req.params.periodId, 10);
  const lineId = parseInt(req.params.lineId, 10);
  if (Number.isNaN(periodId) || Number.isNaN(lineId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createLineSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const update: Record<string, unknown> = {};
  if (parsed.data?.category != null) update.category = parsed.data.category;
  if (parsed.data?.description != null) update.description = parsed.data.description;
  if (parsed.data?.amount != null) update.amount = parsed.data.amount.toFixed(2);
  if (parsed.data?.sortOrder != null) update.sortOrder = parsed.data.sortOrder;
  if (Object.keys(update).length === 0) {
    const [existing] = await tenantDb(slug, (db) => db.select().from(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.budgetPeriodId, periodId))).limit(1));
    return existing ? res.json(existing) : res.status(404).json({ error: "Not found" });
  }
  const [row] = await tenantDb(slug, (db) => db.update(budgetLines).set(update).where(and(eq(budgetLines.id, lineId), eq(budgetLines.budgetPeriodId, periodId))).returning());
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

budgetRouter.delete("/periods/:periodId/lines/:lineId", async (req, res) => {
  const periodId = parseInt(req.params.periodId, 10);
  const lineId = parseInt(req.params.lineId, 10);
  if (Number.isNaN(periodId) || Number.isNaN(lineId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [deleted] = await tenantDb(slug, (db) => db.delete(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.budgetPeriodId, periodId))).returning({ id: budgetLines.id }));
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

budgetRouter.get("/periods/:id/missing-payments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) => db.select().from(budgetMissingPayments).where(eq(budgetMissingPayments.budgetPeriodId, id)));
  res.json(list);
});

budgetRouter.post("/periods/:id/missing-payments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createMissingPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(budgetMissingPayments)
      .values({
        budgetPeriodId: id,
        unitId: parsed.data!.unitId,
        amount: parsed.data!.amount.toFixed(2),
        reason: parsed.data!.reason?.trim() || null,
      })
      .returning()
  );
  if (!row) {
    res.status(500).json({ error: "Failed to create" });
    return;
  }
  res.status(201).json(row);
});

budgetRouter.delete("/periods/:periodId/missing-payments/:mpId", async (req, res) => {
  const periodId = parseInt(req.params.periodId, 10);
  const mpId = parseInt(req.params.mpId, 10);
  if (Number.isNaN(periodId) || Number.isNaN(mpId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [deleted] = await tenantDb(slug, (db) =>
    db.delete(budgetMissingPayments).where(and(eq(budgetMissingPayments.id, mpId), eq(budgetMissingPayments.budgetPeriodId, periodId))).returning({ id: budgetMissingPayments.id })
  );
  if (!deleted) res.status(404).json({ error: "Not found" });
  else res.status(204).send();
});

budgetRouter.get("/periods/:id/contributions", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) => db.select().from(budgetUnitContributions).where(eq(budgetUnitContributions.budgetPeriodId, id)));
  res.json(list);
});

budgetRouter.post("/periods/:id/contributions", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createContributionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [existing] = await tenantDb(slug, (db) =>
    db.select().from(budgetUnitContributions).where(and(eq(budgetUnitContributions.budgetPeriodId, id), eq(budgetUnitContributions.unitId, parsed.data!.unitId))).limit(1)
  );
  if (existing) {
    const [row] = await tenantDb(slug, (db) =>
      db.update(budgetUnitContributions).set({ amount: parsed.data!.amount.toFixed(2) }).where(eq(budgetUnitContributions.id, existing.id)).returning()
    );
    return res.json(row!);
  }
  const [row] = await tenantDb(slug, (db) =>
    db.insert(budgetUnitContributions).values({ budgetPeriodId: id, unitId: parsed.data!.unitId, amount: parsed.data!.amount.toFixed(2) }).returning()
  );
  if (!row) {
    res.status(500).json({ error: "Failed to create" });
    return;
  }
  res.status(201).json(row);
});

budgetRouter.patch("/periods/:periodId/contributions/:contribId", async (req, res) => {
  const periodId = parseInt(req.params.periodId, 10);
  const contribId = parseInt(req.params.contribId, 10);
  if (Number.isNaN(periodId) || Number.isNaN(contribId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = z.object({ amount: z.number().nonnegative() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.update(budgetUnitContributions).set({ amount: parsed.data!.amount.toFixed(2) }).where(and(eq(budgetUnitContributions.id, contribId), eq(budgetUnitContributions.budgetPeriodId, periodId))).returning()
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});
