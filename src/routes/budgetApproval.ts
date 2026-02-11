import { Router } from "express";
import { setTenantFromHeader } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  budgetPeriods,
  budgetLines,
  budgetUnitContributions,
  budgetApprovals,
  budgetPeriodDocuments,
  financialTransactions,
  units,
  buildings,
  documents as documentsTable,
} from "../db/schema/tenant.js";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage/index.js";

export const budgetApprovalRouter = Router();
budgetApprovalRouter.use(setTenantFromHeader);

/** GET approval info by token (no auth). Query: ?token= */
budgetApprovalRouter.get("/periods/:id/approve-info", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = (req.query.token as string)?.trim();
  if (Number.isNaN(id) || !token) {
    res.status(400).json({ error: "Invalid id or missing token" });
    return;
  }
  const slug = req.tenantSlug!;
  const [approval] = await tenantDb(slug, (db) =>
    db.select().from(budgetApprovals).where(and(eq(budgetApprovals.budgetPeriodId, id), eq(budgetApprovals.token, token))).limit(1)
  );
  if (!approval) {
    res.status(404).json({ error: "Approval link not found or invalid" });
    return;
  }
  if (approval.budgetPeriodId !== id) {
    res.status(404).json({ error: "Approval link not found" });
    return;
  }
  const [period] = await tenantDb(slug, (db) => db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).limit(1));
  if (!period) {
    res.status(404).json({ error: "Budget period not found" });
    return;
  }
  const lines = await tenantDb(slug, (db) =>
    db.select().from(budgetLines).where(eq(budgetLines.budgetPeriodId, id)).orderBy(budgetLines.sortOrder, budgetLines.id)
  );
  const contributions = await tenantDb(slug, (db) =>
    db.select().from(budgetUnitContributions).where(eq(budgetUnitContributions.budgetPeriodId, id))
  );
  const unitsList = await tenantDb(slug, (db) => db.select().from(units).where(eq(units.buildingId, period.buildingId)));
  const [building] = await tenantDb(slug, (db) => db.select().from(buildings).where(eq(buildings.id, period.buildingId)).limit(1));
  const total = lines.reduce((sum, l) => sum + parseFloat(String(l.amount)), 0);
  const openingBalance = parseFloat(String(period.openingBalance));
  const totalContributions = contributions.reduce((s, c) => s + parseFloat(String(c.amount)), 0);
  const contributionByUnit = Object.fromEntries(contributions.map((c) => [c.unitId, parseFloat(String(c.amount))]));
  const transactionsForPeriod = await tenantDb(slug, (db) =>
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
  const attachedDocs = await tenantDb(slug, (db) =>
    db
      .select({
        id: documentsTable.id,
        title: documentsTable.title,
        filename: documentsTable.filename,
      })
      .from(budgetPeriodDocuments)
      .innerJoin(documentsTable, eq(budgetPeriodDocuments.documentId, documentsTable.id))
      .where(eq(budgetPeriodDocuments.budgetPeriodId, id))
  );
  const approvedCountResult = await tenantDb(slug, (db) =>
    db
      .select({ count: sql<number>`count(distinct ${budgetApprovals.unitId})` })
      .from(budgetApprovals)
      .where(and(eq(budgetApprovals.budgetPeriodId, id), sql`${budgetApprovals.approvedAt} is not null`))
  );
  const approvedUnitCount = Number(approvedCountResult[0]?.count ?? 0);
  const unitCount = unitsList.length;
  const requiredApprovalCount = Math.ceil((2 / 3) * unitCount);
  const sharePerUnit = contributionByUnit[approval.unitId] ?? 0;
  const [unitRow] = unitsList.filter((u) => u.id === approval.unitId);
  const canRespond = approval.approvedAt == null && approval.rejectedAt == null;
  res.json({
    period: {
      id: period.id,
      name: period.name,
      year: period.year,
      status: period.status,
      buildingName: building?.name ?? null,
      total: Math.round(total * 100) / 100,
      unitCount,
      openingBalance,
      totalContributions: Math.round(totalContributions * 100) / 100,
    },
    lines: lines.map((l) => ({
      id: l.id,
      category: l.category,
      description: l.description,
      amount: String(l.amount),
      sortOrder: l.sortOrder,
    })),
    units: unitsList.map((u) => ({
      id: u.id,
      identifier: u.identifier,
      contribution: contributionByUnit[u.id] ?? 0,
      totalPaid: totalPaidByUnit[u.id] ?? 0,
    })),
    documents: attachedDocs.map((d) => ({ id: d.id, title: d.title, filename: d.filename })),
    approvedUnitCount,
    requiredApprovalCount,
    sharePerUnit: sharePerUnit.toFixed(2),
    unitIdentifier: unitRow?.identifier ?? null,
    canApprove: canRespond,
    canReject: canRespond,
    alreadyApproved: approval.approvedAt != null,
    alreadyRejected: approval.rejectedAt != null,
    rejectionReason: approval.rejectionReason ?? null,
  });
});

/** POST approve by token (no auth). Body: { token } */
budgetApprovalRouter.post("/periods/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = (req.body?.token as string)?.trim();
  if (Number.isNaN(id) || !token) {
    res.status(400).json({ error: "Invalid id or missing token" });
    return;
  }
  const slug = req.tenantSlug!;
  const [approval] = await tenantDb(slug, (db) =>
    db.select().from(budgetApprovals).where(and(eq(budgetApprovals.budgetPeriodId, id), eq(budgetApprovals.token, token))).limit(1)
  );
  if (!approval) {
    res.status(404).json({ error: "Approval link not found or invalid" });
    return;
  }
  if (approval.approvedAt) {
    res.json({ ok: true, message: "Already approved" });
    return;
  }
  if (approval.rejectedAt) {
    res.status(400).json({ error: "You have already declined this budget. Contact management to change your response." });
    return;
  }
  await tenantDb(slug, (db) =>
    db.update(budgetApprovals).set({ approvedAt: new Date() }).where(eq(budgetApprovals.id, approval.id))
  );
  const unitsList = await tenantDb(slug, async (db) => {
    const [p] = await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).limit(1);
    if (!p) return [];
    return db.select().from(units).where(eq(units.buildingId, p.buildingId));
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
  if (approvedUnitCount >= requiredApprovalCount) {
    await tenantDb(slug, (db) =>
      db.update(budgetPeriods).set({ status: "approved", approvedAt: new Date() }).where(eq(budgetPeriods.id, id))
    );
  }
  res.json({
    ok: true,
    message: "Approval recorded",
    approvedUnitCount,
    requiredApprovalCount,
    unitCount,
    quorumReached: approvedUnitCount >= requiredApprovalCount,
  });
});

/** POST reject by token (no auth). Body: { token, reason } */
budgetApprovalRouter.post("/periods/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = (req.body?.token as string)?.trim();
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 2000) : "";
  if (Number.isNaN(id) || !token) {
    res.status(400).json({ error: "Invalid id or missing token" });
    return;
  }
  const slug = req.tenantSlug!;
  const [approval] = await tenantDb(slug, (db) =>
    db.select().from(budgetApprovals).where(and(eq(budgetApprovals.budgetPeriodId, id), eq(budgetApprovals.token, token))).limit(1)
  );
  if (!approval) {
    res.status(404).json({ error: "Approval link not found or invalid" });
    return;
  }
  if (approval.approvedAt) {
    res.status(400).json({ error: "You have already approved this budget." });
    return;
  }
  if (approval.rejectedAt) {
    res.json({ ok: true, message: "Decline already recorded." });
    return;
  }
  await tenantDb(slug, (db) =>
    db.update(budgetApprovals).set({ rejectedAt: new Date(), rejectionReason: reason || null }).where(eq(budgetApprovals.id, approval.id))
  );
  res.json({ ok: true, message: "Decline recorded. Your reason has been shared with management." });
});

/** GET document download for approval flow (no auth). Query: ?token= */
budgetApprovalRouter.get("/periods/:id/documents/:documentId/download", async (req, res) => {
  const periodId = parseInt(req.params.id, 10);
  const documentId = parseInt(req.params.documentId, 10);
  const token = (req.query.token as string)?.trim();
  if (Number.isNaN(periodId) || Number.isNaN(documentId) || !token) {
    res.status(400).json({ error: "Invalid id or missing token" });
    return;
  }
  const slug = req.tenantSlug!;
  const [approval] = await tenantDb(slug, (db) =>
    db.select().from(budgetApprovals).where(and(eq(budgetApprovals.budgetPeriodId, periodId), eq(budgetApprovals.token, token))).limit(1)
  );
  if (!approval) {
    res.status(404).json({ error: "Invalid or expired link" });
    return;
  }
  const [link] = await tenantDb(slug, (db) =>
    db
      .select()
      .from(budgetPeriodDocuments)
      .where(and(eq(budgetPeriodDocuments.budgetPeriodId, periodId), eq(budgetPeriodDocuments.documentId, documentId)))
      .limit(1)
  );
  if (!link) {
    res.status(404).json({ error: "Document not found for this budget" });
    return;
  }
  const [doc] = await tenantDb(slug, (db) =>
    db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1)
  );
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const stream = await storage.get(doc.fileKey);
  if (!stream) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
  stream.pipe(res);
});
