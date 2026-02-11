import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { isResident, getResidentBuildingIds, requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  announcements as announcementsTable,
  announcementSeen,
} from "../db/schema/tenant.js";
import { eq, and, desc, or, inArray, isNull } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";
import { getPublicUser } from "../services/userLookup.js";

export const announcementsRouter = Router();
announcementsRouter.use(requireAuth, requireTenant);

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  buildingId: z.number().int().positive().optional().nullable(),
});
const updateAnnouncementSchema = createAnnouncementSchema.partial();

announcementsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;
  const list = await tenantDb(slug, async (db) => {
    let rows;
    if (isResident(req)) {
      const buildingIds = await getResidentBuildingIds(slug, userId);
      const residentCondition =
        buildingIds.length > 0
          ? or(isNull(announcementsTable.buildingId), inArray(announcementsTable.buildingId, buildingIds))
          : isNull(announcementsTable.buildingId);
      rows = await db
        .select()
        .from(announcementsTable)
        .where(residentCondition)
        .orderBy(desc(announcementsTable.createdAt));
    } else {
      rows = await db
        .select()
        .from(announcementsTable)
        .orderBy(desc(announcementsTable.createdAt));
    }
    const withSeen = await Promise.all(
      rows.map(async (row) => {
        const [seenRow] = await db
          .select()
          .from(announcementSeen)
          .where(
            and(
              eq(announcementSeen.announcementId, row.id),
              eq(announcementSeen.userId, userId)
            )
          )
          .limit(1);
        return { ...row, seen: !!seenRow };
      })
    );
    return withSeen;
  });
  res.json(list);
});

announcementsRouter.post("/", requireStaff, async (req, res) => {
  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(announcementsTable)
      .values({
        title: parsed.data.title,
        body: parsed.data.body ?? null,
        buildingId: parsed.data.buildingId ?? null,
        createdBy: actorId,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "announcement", entityId: r.id, details: { title: r.title } });
    return r ? [r] : [];
  });
  res.status(201).json(row);
});

announcementsRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.select().from(announcementsTable).where(eq(announcementsTable.id, id)).limit(1)
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (isResident(req) && row.buildingId != null) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(row.buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const createdByUser = await getPublicUser(row.createdBy);
  res.json({ ...row, createdByUser: createdByUser ? { id: createdByUser.id, name: createdByUser.name, email: createdByUser.email } : null });
});

announcementsRouter.patch("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .update(announcementsTable)
      .set(parsed.data)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (r) await logAudit(db, { actorId, action: "update", entityType: "announcement", entityId: id, details: parsed.data });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

announcementsRouter.delete("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .delete(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .returning({ id: announcementsTable.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "announcement", entityId: id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

announcementsRouter.post("/:id/seen", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;
  await tenantDb(slug, (db) =>
    db
      .insert(announcementSeen)
      .values({ announcementId: id, userId })
      .onConflictDoNothing({
        target: [announcementSeen.announcementId, announcementSeen.userId],
      })
  );
  res.status(204).send();
});
