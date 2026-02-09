import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { isResident, getResidentUnitIds, getResidentBuildingIds } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import { tickets as ticketsTable, announcements as announcementsTable } from "../db/schema/tenant.js";
import { eq, desc, sql, or, and, inArray, isNull } from "drizzle-orm";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireTenant);

dashboardRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;

  let openTicketsCount = 0;
  let recentAnnouncements: Array<{ id: number; title: string; createdAt: Date }> = [];

  await tenantDb(slug, async (db) => {
    if (isResident(req)) {
      const unitIds = await getResidentUnitIds(slug, userId);
      if (unitIds.length > 0) {
        const [openCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(ticketsTable)
          .where(and(eq(ticketsTable.status, "open"), inArray(ticketsTable.unitId, unitIds)));
        openTicketsCount = openCount?.count ?? 0;
      }
      const buildingIds = await getResidentBuildingIds(slug, userId);
      const announcementCondition =
        buildingIds.length > 0
          ? or(isNull(announcementsTable.buildingId), inArray(announcementsTable.buildingId, buildingIds))
          : isNull(announcementsTable.buildingId);
      recentAnnouncements = await db
        .select({
          id: announcementsTable.id,
          title: announcementsTable.title,
          createdAt: announcementsTable.createdAt,
        })
        .from(announcementsTable)
        .where(announcementCondition)
        .orderBy(desc(announcementsTable.createdAt))
        .limit(5);
    } else {
      const [openCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .where(eq(ticketsTable.status, "open"));
      openTicketsCount = openCount?.count ?? 0;
      recentAnnouncements = await db
        .select({
          id: announcementsTable.id,
          title: announcementsTable.title,
          createdAt: announcementsTable.createdAt,
        })
        .from(announcementsTable)
        .orderBy(desc(announcementsTable.createdAt))
        .limit(5);
    }
  });

  res.json({
    openTicketsCount,
    recentAnnouncements,
  });
});
