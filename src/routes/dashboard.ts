import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { tenantDb } from "../db/tenantDb.js";
import { tickets as ticketsTable, announcements as announcementsTable } from "../db/schema/tenant.js";
import { eq, desc, sql } from "drizzle-orm";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireTenant);

dashboardRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const [openCount] = await tenantDb(slug, (db) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(eq(ticketsTable.status, "open"))
  );
  const openTicketsCount = openCount?.count ?? 0;
  const recentAnnouncements = await tenantDb(slug, (db) =>
    db
      .select({
        id: announcementsTable.id,
        title: announcementsTable.title,
        createdAt: announcementsTable.createdAt,
      })
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt))
      .limit(5)
  );
  res.json({
    openTicketsCount,
    recentAnnouncements,
  });
});
