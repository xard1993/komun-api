import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { createTenant } from "../services/tenantService.js";
import { publicDb } from "../db/index.js";
import { tenants, tenantUsers, invites as invitesTable } from "../db/schema/public.js";
import { eq } from "drizzle-orm";

export const controlRouter = Router();

controlRouter.use(requireAuth);

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

controlRouter.post("/tenants/:tenantSlug/invites", async (req, res) => {
  const tenantSlug = req.params.tenantSlug;
  if (!req.user!.tenantSlugs.includes(tenantSlug)) {
    res.status(403).json({ error: "Access denied to this tenant" });
    return;
  }
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
