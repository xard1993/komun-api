import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import { documents as documentsTable } from "../db/schema/tenant.js";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage/index.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
});

documentsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const list = await tenantDb(slug, (db) =>
    db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(limit).offset(offset)
  );
  res.json(list);
});

documentsRouter.post("/", upload.single("file"), async (req, res) => {
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
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(documentsTable)
      .values({
        title: parsed.data.title,
        fileKey,
        filename: file.originalname,
        uploadedBy: req.user!.userId,
      })
      .returning()
  );
  res.status(201).json(row);
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
  const stream = await storage.get(doc.fileKey);
  if (!stream) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
  stream.pipe(res);
});
