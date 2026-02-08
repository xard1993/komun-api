import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  tickets as ticketsTable,
  ticketComments,
  ticketAttachments,
} from "../db/schema/tenant.js";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage/index.js";

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth, requireTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const createTicketSchema = z.object({
  unitId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
});
const updateTicketSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});
const createCommentSchema = z.object({ body: z.string().min(1) });

ticketsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) =>
    db.select().from(ticketsTable).orderBy(desc(ticketsTable.createdAt))
  );
  res.json(list);
});

ticketsRouter.post("/", async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(ticketsTable)
      .values({
        unitId: parsed.data.unitId,
        reporterId: req.user!.userId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      })
      .returning()
  );
  res.status(201).json(row);
});

ticketsRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db.select().from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1)
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

ticketsRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const update: Record<string, unknown> = { ...parsed.data };
  if (Object.keys(update).length > 0) {
    update.updatedAt = new Date();
  }
  const [row] = await tenantDb(slug, (db) =>
    db.update(ticketsTable).set(update).where(eq(ticketsTable.id, id)).returning()
  );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

ticketsRouter.get("/:id/comments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) =>
    db.select().from(ticketComments).where(eq(ticketComments.ticketId, id)).orderBy(ticketComments.createdAt)
  );
  res.json(list);
});

ticketsRouter.post("/:id/comments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(ticketComments)
      .values({ ticketId: id, userId: req.user!.userId, body: parsed.data.body })
      .returning()
  );
  res.status(201).json(row);
});

ticketsRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const slug = req.tenantSlug!;
  const ext = file.originalname.split(".").pop() ?? "bin";
  const fileKey = `tenants/${slug}/tickets/${id}/${crypto.randomUUID()}.${ext}`;
  await storage.put(fileKey, file.buffer, file.mimetype);
  const [row] = await tenantDb(slug, (db) =>
    db
      .insert(ticketAttachments)
      .values({ ticketId: id, fileKey, filename: file.originalname })
      .returning()
  );
  res.status(201).json(row);
});

ticketsRouter.get("/:id/attachments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const list = await tenantDb(slug, (db) =>
    db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId, id))
  );
  res.json(list);
});

ticketsRouter.get("/:id/attachments/:attachmentId/download", async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const attachmentId = parseInt(req.params.attachmentId, 10);
  if (Number.isNaN(ticketId) || Number.isNaN(attachmentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [att] = await tenantDb(slug, (db) =>
    db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.id, attachmentId))
      .limit(1)
  );
  if (!att || att.ticketId !== ticketId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const stream = await storage.get(att.fileKey);
  if (!stream) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${att.filename}"`);
  stream.pipe(res);
});
