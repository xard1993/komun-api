import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { publicDb } from "../db/index.js";
import { tenants } from "../db/schema/public.js";
import { eq } from "drizzle-orm";
import { storage } from "../storage/index.js";

export const tenantSettingsRouter = Router();
tenantSettingsRouter.use(requireAuth, requireTenant, requireStaff);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB for logo

/** GET /tenant-settings - company settings for current tenant (staff only) */
tenantSettingsRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const [tenant] = await publicDb
    .select({ id: tenants.id, name: tenants.name, logo: tenants.logo, address: tenants.address, currency: tenants.currency })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  res.json({
    name: tenant.name,
    logo: tenant.logo ?? null,
    address: tenant.address ?? null,
    currency: tenant.currency ?? null,
  });
});

const updateSettingsSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  logo: z.string().max(512).nullable().optional(),
  address: z.string().max(5000).nullable().optional(),
  currency: z.string().max(16).nullable().optional(),
});

/** PATCH /tenant-settings - update company settings (staff only) */
tenantSettingsRouter.patch("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const [tenant] = await publicDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const updates: { name?: string; logo?: string | null; address?: string | null; currency?: string | null } = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.logo !== undefined) updates.logo = parsed.data.logo;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.currency !== undefined) updates.currency = parsed.data.currency;
  if (Object.keys(updates).length === 0) {
    const [current] = await publicDb
      .select({ name: tenants.name, logo: tenants.logo, address: tenants.address, currency: tenants.currency })
      .from(tenants)
      .where(eq(tenants.id, tenant.id))
      .limit(1);
    return res.json({
      name: current?.name ?? null,
      logo: current?.logo ?? null,
      address: current?.address ?? null,
      currency: current?.currency ?? null,
    });
  }
  await publicDb.update(tenants).set(updates).where(eq(tenants.id, tenant.id));
  const [updated] = await publicDb
    .select({ name: tenants.name, logo: tenants.logo, address: tenants.address, currency: tenants.currency })
    .from(tenants)
    .where(eq(tenants.id, tenant.id))
    .limit(1);
  res.json({
    name: updated?.name ?? null,
    logo: updated?.logo ?? null,
    address: updated?.address ?? null,
    currency: updated?.currency ?? null,
  });
});

/** POST /tenant-settings/logo - upload logo image (staff only). Returns { logo: fileKey }. */
tenantSettingsRouter.post("/logo", upload.single("file"), async (req, res) => {
  const slug = req.tenantSlug!;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowed.includes(file.mimetype)) {
    res.status(400).json({ error: "Invalid file type. Use JPEG, PNG, GIF or WebP." });
    return;
  }
  const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "png";
  const fileKey = `tenants/${slug}/logo/${crypto.randomUUID()}.${ext}`;
  await storage.put(fileKey, file.buffer, file.mimetype);

  const [tenant] = await publicDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  await publicDb.update(tenants).set({ logo: fileKey }).where(eq(tenants.id, tenant.id));
  res.json({ logo: fileKey });
});

/** GET /tenant-settings/logo - stream logo image when logo is a storage key */
tenantSettingsRouter.get("/logo", async (req, res) => {
  const slug = req.tenantSlug!;
  const [tenant] = await publicDb
    .select({ logo: tenants.logo })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant?.logo || !tenant.logo.startsWith("tenants/")) {
    res.status(404).json({ error: "Logo not set or not a stored file" });
    return;
  }
  const stream = await storage.get(tenant.logo);
  if (!stream) {
    res.status(404).json({ error: "Logo file not found" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  stream.pipe(res);
});
