import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { isResident, getResidentUnitIds, requireStaff } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  tickets as ticketsTable,
  ticketComments,
  ticketAttachments,
} from "../db/schema/tenant.js";
import { eq, desc, inArray } from "drizzle-orm";
import { storage } from "../storage/index.js";
import type { Request } from "express";

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
  const list = await tenantDb(slug, async (db) => {
    if (isResident(req)) {
      const unitIds = await getResidentUnitIds(slug, req.user!.userId);
      if (unitIds.length === 0) return [];
      return db
        .select()
        .from(ticketsTable)
        .where(inArray(ticketsTable.unitId, unitIds))
        .orderBy(desc(ticketsTable.createdAt));
    }
    return db.select().from(ticketsTable).orderBy(desc(ticketsTable.createdAt));
  });
  res.json(list);
});

ticketsRouter.post("/", async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  if (isResident(req)) {
    const unitIds = await getResidentUnitIds(slug, req.user!.userId);
    if (!unitIds.includes(parsed.data.unitId)) {
      res.status(403).json({ error: "You can only create tickets for your own unit(s)" });
      return;
    }
  }
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

async function assertTicketAccess(
  slug: string,
  ticketId: number,
  req: Request
): Promise<{ ticket: Record<string, unknown> } | { status: number; body: object }> {
  const [ticket] = await tenantDb(slug, (db) =>
    db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1)
  );
  if (!ticket) return { status: 404, body: { error: "Not found" } };
  if (isResident(req)) {
    const unitIds = await getResidentUnitIds(slug, req.user!.userId);
    if (!unitIds.includes(ticket.unitId)) return { status: 404, body: { error: "Not found" } };
  }
  return { ticket };
}

ticketsRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const result = await assertTicketAccess(slug, id, req);
  if ("status" in result) {
    res.status(result.status).json(result.body);
    return;
  }
  res.json(result.ticket);
});

ticketsRouter.delete("/:id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const [deleted] = await tenantDb(slug, (db) =>
    db.delete(ticketsTable).where(eq(ticketsTable.id, id)).returning({ id: ticketsTable.id })
  );
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

ticketsRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const slug = req.tenantSlug!;
  const access = await assertTicketAccess(slug, id, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
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
  const access = await assertTicketAccess(slug, id, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
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
  const slug = req.tenantSlug!;
  const access = await assertTicketAccess(slug, id, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
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
  const slug = req.tenantSlug!;
  const access = await assertTicketAccess(slug, id, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
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
  const access = await assertTicketAccess(slug, id, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
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
  const access = await assertTicketAccess(slug, ticketId, req);
  if ("status" in access) {
    res.status(access.status).json(access.body);
    return;
  }
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
