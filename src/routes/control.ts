import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { createTenant } from "../services/tenantService.js";
import { publicDb } from "../db/index.js";
import { tenants, tenantUsers, invites as invitesTable } from "../db/schema/public.js";
import { and, desc, eq, isNull } from "drizzle-orm";

export const controlRouter = Router();

controlRouter.use(requireAuth);

function setTenantFromParam(req: Request, res: Response, next: NextFunction): void {
  const tenantSlug = req.params.tenantSlug;
  if (!tenantSlug || !req.user!.tenantSlugs.includes(tenantSlug)) {
    res.status(403).json({ error: "Access denied to this tenant" });
    return;
  }
  req.tenantSlug = tenantSlug;
  next();
}

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["org_owner", "org_admin", "property_manager", "accountant", "support", "resident"]),
  unitId: z.number().int().positive().optional(),
});

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Slug: lowercase letters, numbers, _ and - only"),
});

controlRouter.post("/tenants", async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { name, slug } = parsed.data;
  const existing = await publicDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Tenant slug already exists" });
    return;
  }
  try {
    const tenant = await createTenant(name, slug, req.user!.userId);
    res.status(201).json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create tenant" });
  }
});

controlRouter.get("/tenants", async (req, res) => {
  const list = await publicDb
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, req.user!.userId));
  res.json(list);
});

controlRouter.post("/tenants/:tenantSlug/invites", setTenantFromParam, requireStaff, async (req, res) => {
  const tenantSlug = req.tenantSlug!;
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { email, role, unitId } = parsed.data;
  if (role === "resident" && !unitId) {
    res.status(400).json({ error: "unitId required for resident invites" });
    return;
  }
  const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await publicDb.insert(invitesTable).values({
    tenantId: tenant.id,
    email,
    role,
    unitId: unitId ?? null,
    token,
    expiresAt,
  });
  res.status(201).json({
    email,
    role,
    expiresAt,
    inviteLink: `${process.env.CORS_ORIGIN ?? "http://localhost:3000"}/invites/accept/${token}`,
  });
});

controlRouter.get("/tenants/:tenantSlug/invites", setTenantFromParam, requireStaff, async (req, res) => {
  const tenantSlug = req.tenantSlug!;
  const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  // Select only columns that exist in all migration states (revoked_at may be missing if 0003 not applied)
  const rows = await publicDb
    .select({
      id: invitesTable.id,
      email: invitesTable.email,
      role: invitesTable.role,
      unitId: invitesTable.unitId,
      createdAt: invitesTable.createdAt,
      expiresAt: invitesTable.expiresAt,
      acceptedAt: invitesTable.acceptedAt,
      acceptedUserId: invitesTable.acceptedUserId,
    })
    .from(invitesTable)
    .where(eq(invitesTable.tenantId, tenant.id))
    .orderBy(desc(invitesTable.createdAt));

  res.json(rows);
});

controlRouter.delete("/tenants/:tenantSlug/invites/:inviteId", setTenantFromParam, requireStaff, async (req, res) => {
  const tenantSlug = req.tenantSlug!;
  const inviteId = parseInt(req.params.inviteId, 10);
  if (Number.isNaN(inviteId)) {
    res.status(400).json({ error: "Invalid invite id" });
    return;
  }

  const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const whereClause = and(
    eq(invitesTable.id, inviteId),
    eq(invitesTable.tenantId, tenant.id),
    isNull(invitesTable.acceptedAt)
  );

  try {
    const revoked = await publicDb
      .update(invitesTable)
      .set({ revokedAt: new Date(), revokedUserId: req.user!.userId })
      .where(and(whereClause, isNull(invitesTable.revokedAt)))
      .returning({ id: invitesTable.id });

    if (revoked.length > 0) {
      res.json({ ok: true });
      return;
    }
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (msg !== "42703") throw err;
    // Column revoked_at does not exist: fall back to deleting the invite row
    const deleted = await publicDb
      .delete(invitesTable)
      .where(whereClause)
      .returning({ id: invitesTable.id });
    if (deleted.length > 0) {
      res.json({ ok: true });
      return;
    }
  }

  res.status(404).json({ error: "Invite not found (or already accepted)" });
});
