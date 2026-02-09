import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { requireStaff } from "../middleware/role.js";
import { publicDb } from "../db/index.js";
import { tenants, tenantUsers, users } from "../db/schema/public.js";
import { unitMembers } from "../db/schema/tenant.js";
import { tenantDb } from "../db/tenantDb.js";
import { eq, and, inArray } from "drizzle-orm";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireTenant, requireStaff);

async function getTenantId(slug: string): Promise<number | null> {
  const [row] = await publicDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

/** GET /users - list all users in this tenant (staff only) */
usersRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const tenantId = await getTenantId(slug);
  if (!tenantId) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const list = await publicDb
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      role: tenantUsers.role,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(tenantUsers.userId, users.id))
    .where(eq(tenantUsers.tenantId, tenantId));
  res.json(list);
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

/** POST /users/:userId/reset-password - set new password for a user in this tenant (staff only) */
usersRouter.post("/:userId/reset-password", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const slug = req.tenantSlug!;
  const tenantId = await getTenantId(slug);
  if (!tenantId) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const [membership] = await publicDb
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "User not found in this tenant" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await publicDb.update(users).set({ passwordHash }).where(eq(users.id, userId));
  res.status(204).send();
});

/** DELETE /users/:userId - remove user from this tenant (staff only). ?permanent=true removes from all tenants and deletes user. Cannot remove self. */
usersRouter.delete("/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (userId === req.user!.userId) {
    res.status(400).json({ error: "You cannot remove yourself from the tenant" });
    return;
  }
  const slug = req.tenantSlug!;
  const tenantId = await getTenantId(slug);
  if (!tenantId) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const permanent = req.query.permanent === "true";

  if (permanent) {
    const userTenants = await publicDb
      .select({ tenantId: tenantUsers.tenantId })
      .from(tenantUsers)
      .where(eq(tenantUsers.userId, userId));
    const tenantIds = userTenants.map((r) => r.tenantId);
    if (tenantIds.length > 0) {
      const tenantRows = await publicDb
        .select({ id: tenants.id, slug: tenants.slug })
        .from(tenants)
        .where(inArray(tenants.id, tenantIds));
      for (const t of tenantRows) {
        await tenantDb(t.slug, (db) =>
          db.delete(unitMembers).where(eq(unitMembers.userId, userId))
        );
      }
    }
    await publicDb.delete(tenantUsers).where(eq(tenantUsers.userId, userId));
    await publicDb.delete(users).where(eq(users.id, userId));
    res.status(204).send();
    return;
  }

  const [deleted] = await publicDb
    .delete(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)))
    .returning({ id: tenantUsers.id });
  if (!deleted) {
    res.status(404).json({ error: "User not found in this tenant" });
    return;
  }
  res.status(204).send();
});
