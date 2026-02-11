import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { documents as documentsTable } from "../db/schema/tenant.js";
import { eq, desc, or, isNull, inArray } from "drizzle-orm";
import { storage } from "../storage/index.js";
import { isResident, getResidentBuildingIds } from "../middleware/role.js";
import { logAudit } from "../services/auditLog.js";
import { getPublicUsers } from "../services/userLookup.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  buildingId: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v == null ? null : Number(v))),
});

documentsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const buildingIdParam = req.query.buildingId as string | undefined;
  const buildingId = buildingIdParam ? parseInt(buildingIdParam, 10) : undefined;

  const list = await tenantDb(slug, async (db) => {
    if (isResident(req)) {
      const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
      if (buildingId != null && !Number.isNaN(buildingId) && buildingIds.includes(buildingId)) {
        return db
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.buildingId, buildingId))
          .orderBy(desc(documentsTable.createdAt))
          .limit(limit)
          .offset(offset);
      }
      const condition =
        buildingIds.length > 0
          ? or(isNull(documentsTable.buildingId), inArray(documentsTable.buildingId, buildingIds))
          : isNull(documentsTable.buildingId);
      return db
        .select()
        .from(documentsTable)
        .where(condition)
        .orderBy(desc(documentsTable.createdAt))
        .limit(limit)
        .offset(offset);
    }
    if (buildingId != null && !Number.isNaN(buildingId)) {
      return db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.buildingId, buildingId))
        .orderBy(desc(documentsTable.createdAt))
        .limit(limit)
        .offset(offset);
    }
    return db
      .select()
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt))
      .limit(limit)
      .offset(offset);
  });
  const userIds = [...new Set(list.map((d) => d.uploadedBy))];
  const userMap = await getPublicUsers(userIds);
  const listWithUsers = list.map((d) => ({
    ...d,
    uploadedByUser: userMap[d.uploadedBy] ? { id: userMap[d.uploadedBy].id, name: userMap[d.uploadedBy].name, email: userMap[d.uploadedBy].email } : null,
  }));
  res.json(listWithUsers);
});

documentsRouter.post("/", requireStaff, upload.single("file"), async (req, res) => {
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const slug = req.tenantSlug!;
  const ext = file.originalname.split(".").pop() ?? "bin";
  const fileKey = `tenants/${slug}/documents/${crypto.randomUUID()}.${ext}`;
  await storage.put(fileKey, file.buffer, file.mimetype);
  const buildingId = parsed.data.buildingId != null && !Number.isNaN(parsed.data.buildingId) ? parsed.data.buildingId : null;
  const actorId = req.user!.userId;
  const [row] = await tenantDb(slug, async (db) => {
    const [r] = await db
      .insert(documentsTable)
      .values({
        title: parsed.data.title,
        buildingId,
        fileKey,
        filename: file.originalname,
        uploadedBy: actorId,
      })
      .returning();
    if (r) await logAudit(db, { actorId, action: "create", entityType: "document", entityId: r.id, details: { title: r.title, filename: r.filename } });
    return r ? [r] : [];
  });
  res.status(201).json(row);
});

/** DELETE /documents/:id - staff only; removes record and storage file */
documentsRouter.delete("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [doc] = await tenantDb(slug, (db) =>
    db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1)
  );
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const actorId = req.user!.userId;
  await tenantDb(slug, async (db) => {
    await db.delete(documentsTable).where(eq(documentsTable.id, id));
    await logAudit(db, { actorId, action: "delete", entityType: "document", entityId: id, details: { title: doc.title } });
  });
  try {
    await storage.delete(doc.fileKey);
  } catch {
    // best-effort; record is already removed
  }
  res.status(204).send();
});

documentsRouter.get("/:id/download", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [doc] = await tenantDb(slug, (db) =>
    db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1)
  );
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (isResident(req) && doc.buildingId != null) {
    const buildingIds = await getResidentBuildingIds(slug, req.user!.userId);
    if (!buildingIds.includes(doc.buildingId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const stream = await storage.get(doc.fileKey);
  if (!stream) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
  stream.pipe(res);
});
