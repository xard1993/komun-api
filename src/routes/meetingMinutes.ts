import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { isResident, getResidentBuildingIds, requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { meetingMinutes as meetingMinutesTable } from "../db/schema/tenant.js";
import { eq, desc, inArray } from "drizzle-orm";
import { logAudit } from "../services/auditLog.js";
import { getPublicUser } from "../services/userLookup.js";

export const meetingMinutesRouter = Router();
meetingMinutesRouter.use(requireAuth, requireTenant);

const createMinutesSchema = z.object({
  buildingId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  // Accept any date-like string (e.g. from datetime-local: "2026-02-11T13:51")
  meetingDate: z.string().optional(),
});

const updateMinutesSchema = createMinutesSchema.partial();

// GET /meeting-minutes?buildingId=123 - list minutes, optionally scoped to a building
meetingMinutesRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const buildingIdParam = req.query.buildingId as string | undefined;
  const buildingId = buildingIdParam ? parseInt(buildingIdParam, 10) : undefined;

  const list = await tenantDb(slug, async (db) => {
    if (isResident(req)) {
      const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
      if (buildingIds.length === 0) return [];

      if (buildingId != null && !Number.isNaN(buildingId)) {
        if (!buildingIds.includes(buildingId)) return [];
        return db
          .select()
          .from(meetingMinutesTable)
          .where(eq(meetingMinutesTable.buildingId, buildingId))
          .orderBy(desc(meetingMinutesTable.meetingDate ?? meetingMinutesTable.createdAt));
      }

      return db
        .select()
        .from(meetingMinutesTable)
        .where(inArray(meetingMinutesTable.buildingId, buildingIds))
        .orderBy(desc(meetingMinutesTable.meetingDate ?? meetingMinutesTable.createdAt));
    }

    if (buildingId != null && !Number.isNaN(buildingId)) {
      return db
        .select()
        .from(meetingMinutesTable)
        .where(eq(meetingMinutesTable.buildingId, buildingId))
        .orderBy(desc(meetingMinutesTable.meetingDate ?? meetingMinutesTable.createdAt));
    }

    return db
      .select()
      .from(meetingMinutesTable)
      .orderBy(desc(meetingMinutesTable.meetingDate ?? meetingMinutesTable.createdAt));
  });

  res.json(list);
});

// POST /meeting-minutes - staff only
meetingMinutesRouter.post("/", requireStaff, async (req, res) => {
  const parsed = createMinutesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const { buildingId, title, body, meetingDate } = parsed.data;

  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(meetingMinutesTable)
      .values({
        buildingId,
        title,
        body: body ?? null,
        meetingDate: meetingDate ? new Date(meetingDate) : null,
        createdBy: actorId,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "meeting_minutes", entityId: r.id, details: { title: r.title } });
    return r ? [r] : [];
  });

  res.status(201).json(row);
});

// GET /meeting-minutes/:id
meetingMinutesRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.select().from(meetingMinutesTable).where(eq(meetingMinutesTable.id, id)).limit(1)
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (isResident(req)) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(row.buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const createdByUser = await getPublicUser(row.createdBy);
  res.json({ ...row, createdByUser: createdByUser ? { id: createdByUser.id, name: createdByUser.name, email: createdByUser.email } : null });
});

// PATCH /meeting-minutes/:id - staff only
meetingMinutesRouter.patch("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateMinutesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const update: Record<string, unknown> = { ...parsed.data };
  if ("meetingDate" in update && typeof update.meetingDate === "string") {
    update.meetingDate = new Date(update.meetingDate);
  }

  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .update(meetingMinutesTable)
      .set(update)
      .where(eq(meetingMinutesTable.id, id))
      .returning();
    if (r) await logAudit(db, { actorId, action: "update", entityType: "meeting_minutes", entityId: id, details: parsed.data });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// DELETE /meeting-minutes/:id - staff only
meetingMinutesRouter.delete("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .delete(meetingMinutesTable)
      .where(eq(meetingMinutesTable.id, id))
      .returning({ id: meetingMinutesTable.id });
    if (r) await logAudit(db, { actorId, action: "delete", entityType: "meeting_minutes", entityId: id });
    return r ? [r] : [];
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

