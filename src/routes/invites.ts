import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { publicDb } from "../db/index.js";
import { invites as invitesTable, tenants, users, tenantUsers } from "../db/schema/public.js";
import { eq, and } from "drizzle-orm";
import { tenantDb } from "../db/tenantDb.js";
import { unitMembers } from "../db/schema/tenant.js";
import { signToken } from "../middleware/auth.js";

export const invitesRouter = Router();

const acceptInviteSchema = z.object({
  password: z.string().min(8),
  name: z.string().min(1).max(255).optional(),
});

invitesRouter.get("/accept/:token", async (req, res) => {
  const token = req.params.token;
  const [inv] = await publicDb
    .select({
      email: invitesTable.email,
      role: invitesTable.role,
      unitId: invitesTable.unitId,
      expiresAt: invitesTable.expiresAt,
      tenantId: invitesTable.tenantId,
    })
    .from(invitesTable)
    .where(eq(invitesTable.token, token))
    .limit(1);
  if (!inv || new Date(inv.expiresAt) < new Date()) {
    res.status(404).json({ error: "Invite not found or expired" });
    return;
  }
  const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  res.json({
    email: inv.email,
    role: inv.role,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
  });
});

invitesRouter.post("/accept/:token", async (req, res) => {
  const token = req.params.token;
  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const [invite] = await publicDb
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, token))
    .limit(1);
  if (!invite || new Date(invite.expiresAt) < new Date()) {
    res.status(404).json({ error: "Invite not found or expired" });
    return;
  }
  const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.id, invite.tenantId)).limit(1);
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  let [user] = await publicDb.select().from(users).where(eq(users.email, invite.email)).limit(1);
  if (!user) {
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    [user] = await publicDb
      .insert(users)
      .values({
        email: invite.email,
        passwordHash,
        name: parsed.data.name ?? invite.email.split("@")[0],
      })
      .returning();
  }
  const existingTu = await publicDb
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.userId, user.id)))
    .limit(1);
  if (existingTu.length === 0) {
    const orgRole = invite.role as "org_owner" | "org_admin" | "property_manager" | "accountant" | "support" | "resident";
    await publicDb.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: user.id,
      role: orgRole,
    });
  }
  if (invite.role === "resident" && invite.unitId) {
    await tenantDb(tenant.slug, (db) =>
      db.insert(unitMembers).values({
        unitId: invite.unitId!,
        userId: user.id,
        role: "resident",
      })
    );
  }
  await publicDb.delete(invitesTable).where(eq(invitesTable.id, invite.id));
  const tenantUserRows = await publicDb
    .select({ slug: tenants.slug })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, user.id));
  const tenantSlugs = tenantUserRows.map((r) => r.slug);
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
