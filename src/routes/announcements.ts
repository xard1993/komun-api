import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  announcements as announcementsTable,
  announcementSeen,
} from "../db/schema/tenant.js";
import { eq, and, desc } from "drizzle-orm";

export const announcementsRouter = Router();
announcementsRouter.use(requireAuth, requireTenant);

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
});
const updateAnnouncementSchema = createAnnouncementSchema.partial();

announcementsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;
  const list = await tenantDb(slug, async (db) => {
    const rows = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
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

announcementsRouter.post("/", async (req, res) => {
  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(announcementsTable)
      .values({
        ...parsed.data,
        createdBy: req.user!.userId,
      })
      .returning()
  );
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
  res.json(row);
});

announcementsRouter.patch("/:id", async (req, res) => {
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
  const [row] = await tenantDb(slug, (db) =>
    db
      .update(announcementsTable)
      .set(parsed.data)
      .where(eq(announcementsTable.id, id))
      .returning()
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

announcementsRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db
      .delete(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .returning({ id: announcementsTable.id })
  );
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
