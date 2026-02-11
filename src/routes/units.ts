import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { publicDb } from "../db/index.js";
import { users } from "../db/schema/public.js";
import { units as unitsTable, unitMembers } from "../db/schema/tenant.js";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";

export const unitsRouter = Router();
unitsRouter.use(requireAuth, requireTenant, requireStaff);

const updateUnitSchema = z.object({ identifier: z.string().min(1).max(64) }).partial();

/** GET /units/:id/members - residents (unit_members) for this unit with user details */
unitsRouter.get("/:id/members", async (req, res) => {
  const unitId = parseInt(req.params.id, 10);
  if (Number.isNaN(unitId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const members = await tenantDb(slug, (db) =>
    db.select({ userId: unitMembers.userId, role: unitMembers.role }).from(unitMembers).where(eq(unitMembers.unitId, unitId))
  );
  if (members.length === 0) {
    res.json([]);
    return;
  }
  const userIds = [...new Set(members.map((m) => m.userId))];
  const userRows = await publicDb.select({ id: users.id, email: users.email, name: users.name }).from(users).where(inArray(users.id, userIds));
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]));
  const list = members.map((m) => ({
    userId: m.userId,
    email: userMap[m.userId]?.email ?? "",
    name: userMap[m.userId]?.name ?? null,
    role: m.role,
  }));
  res.json(list);
});

unitsRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.select().from(unitsTable).where(eq(unitsTable.id, id)).limit(1)
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

unitsRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.update(unitsTable).set(parsed.data).where(eq(unitsTable.id, id)).returning();
    if (r) await logAudit(db, { actorId, action: "update", entityType: "unit", entityId: id, details: parsed.data });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/** DELETE /units/:id/members/:userId - remove resident from this unit only (staff only) */
unitsRouter.delete("/:id/members/:userId", async (req, res) => {
  const unitId = parseInt(req.params.id, 10);
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(unitId) || Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .delete(unitMembers)
      .where(and(eq(unitMembers.unitId, unitId), eq(unitMembers.userId, userId)))
      .returning({ id: unitMembers.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "unit_member", entityId: r.id, details: { unitId, userId } });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

unitsRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db.delete(unitsTable).where(eq(unitsTable.id, id)).returning({ id: unitsTable.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "unit", entityId: id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});
