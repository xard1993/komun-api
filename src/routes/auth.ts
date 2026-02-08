import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { publicDb } from "../db/index.js";
import { users, tenantUsers, tenants } from "../db/schema/public.js";
import { eq } from "drizzle-orm";
import { signToken, verifyToken, requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await publicDb.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const tenantRows = await publicDb
    .select({ slug: tenants.slug })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, user.id));
  const tenantSlugs = tenantRows.map((r) => r.slug);
  const accessToken = signToken({
    sub: user.id,
    email: user.email,
    tenantSlugs,
  });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantSlugs,
    },
    accessToken,
  });
});

const switchTenantSchema = z.object({
  tenantSlug: z.string().min(1),
});

authRouter.post("/switch-tenant", requireAuth, async (req, res) => {
  const parsed = switchTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { tenantSlug } = parsed.data;
  if (!req.user!.tenantSlugs.includes(tenantSlug)) {
    res.status(403).json({ error: "Access denied to this tenant" });
    return;
  }
  const accessToken = signToken({
    sub: req.user!.userId,
    email: req.user!.email,
    tenantSlugs: req.user!.tenantSlugs,
  });
  res.json({ accessToken, activeTenantSlug: tenantSlug });
});
