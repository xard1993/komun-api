import { Router } from "express";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { isResident, getResidentUnitIds, getResidentBuildingIds } from "../middleware/role.js";
import { tenantDb } from "../db/tenantDb.js";
import {
  tickets as ticketsTable,
  announcements as announcementsTable,
  units as unitsTable,
  buildings as buildingsTable,
  buildingFinancials,
  financialTransactions,
} from "../db/schema/tenant.js";
import { eq, desc, or, and, inArray, isNull, sql, gte } from "drizzle-orm";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireTenant);

dashboardRouter.get("/", async (req, res) => {
  const slug = req.tenantSlug!;
  const userId = req.user!.userId;

  let openTickets: Array<{
    id: number;
    title: string;
    createdAt: Date;
    status: string;
    unitIdentifier: string;
    buildingName: string;
  }> = [];
  let recentAnnouncements: Array<{ id: number; title: string; createdAt: Date }> = [];
  let totalBalance = "0";
  const balanceByBuilding: Array<{ buildingId: number; buildingName: string; balance: string }> = [];
  const transactionsPerMonth: Array<{ month: string; income: number; expenses: number }> = [];

  await tenantDb(slug, async (db) => {
    const resident = isResident(req);
    let unitIds: number[] = [];
    let buildingIds: number[] = [];
    if (resident) {
      unitIds = await getResidentUnitIds(slug, userId);
      buildingIds = await getResidentBuildingIds(slug, userId);
    }

    if (resident) {
      if (unitIds.length > 0) {
        openTickets = await db
          .select({
            id: ticketsTable.id,
            title: ticketsTable.title,
            createdAt: ticketsTable.createdAt,
            status: ticketsTable.status,
            unitIdentifier: unitsTable.identifier,
            buildingName: buildingsTable.name,
          })
          .from(ticketsTable)
          .innerJoin(unitsTable, eq(ticketsTable.unitId, unitsTable.id))
          .innerJoin(buildingsTable, eq(unitsTable.buildingId, buildingsTable.id))
          .where(and(eq(ticketsTable.status, "open"), inArray(ticketsTable.unitId, unitIds)))
          .orderBy(desc(ticketsTable.createdAt))
          .limit(20);
      }
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
      openTickets = await db
        .select({
          id: ticketsTable.id,
          title: ticketsTable.title,
          createdAt: ticketsTable.createdAt,
          status: ticketsTable.status,
          unitIdentifier: unitsTable.identifier,
          buildingName: buildingsTable.name,
        })
        .from(ticketsTable)
        .innerJoin(unitsTable, eq(ticketsTable.unitId, unitsTable.id))
        .innerJoin(buildingsTable, eq(unitsTable.buildingId, buildingsTable.id))
        .where(eq(ticketsTable.status, "open"))
        .orderBy(desc(ticketsTable.createdAt))
        .limit(20);
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

    // Financial stats: which buildings to include
    const allowedBuildingIds = resident
      ? buildingIds
      : (await db.select({ id: buildingsTable.id }).from(buildingsTable)).map((r) => r.id);

    if (allowedBuildingIds.length > 0) {
      // Balance per building (itemized) and total across all user's buildings
      // Use buildings as base and LEFT JOIN financials so every building appears (0 if no financials row yet)
      const buildingBalances = await db
        .select({
          buildingId: buildingsTable.id,
          buildingName: buildingsTable.name,
          currentBalance: buildingFinancials.currentBalance,
        })
        .from(buildingsTable)
        .leftJoin(buildingFinancials, eq(buildingsTable.id, buildingFinancials.buildingId))
        .where(inArray(buildingsTable.id, allowedBuildingIds));
      let sum = 0;
      for (const row of buildingBalances) {
        const balance = String(row.currentBalance ?? "0");
        balanceByBuilding.push({
          buildingId: row.buildingId,
          buildingName: row.buildingName,
          balance,
        });
        sum += parseFloat(balance);
      }
      totalBalance = sum.toFixed(2);

      // Last 6 months: income (positive) and expenses (negative amount as positive number) per month
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const txRows = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${financialTransactions.createdAt}), 'YYYY-MM')`,
          income: sql<string>`coalesce(sum(case when ${financialTransactions.amount} > 0 then ${financialTransactions.amount} else 0 end), 0)`,
          expenses: sql<string>`coalesce(sum(case when ${financialTransactions.amount} < 0 then abs(${financialTransactions.amount}) else 0 end), 0)`,
        })
        .from(financialTransactions)
        .where(
          and(
            inArray(financialTransactions.buildingId, allowedBuildingIds),
            gte(financialTransactions.createdAt, sixMonthsAgo)
          )
        )
        .groupBy(sql`date_trunc('month', ${financialTransactions.createdAt})`)
        .orderBy(sql`date_trunc('month', ${financialTransactions.createdAt})`);
      const monthSet = new Set<string>();
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      const byMonth: Record<string, { income: number; expenses: number }> = {};
      for (const row of txRows) {
        byMonth[row.month] = { income: parseFloat(String(row.income)), expenses: parseFloat(String(row.expenses)) };
      }
      for (const m of [...monthSet].sort()) {
        const v = byMonth[m] ?? { income: 0, expenses: 0 };
        transactionsPerMonth.push({ month: m, income: v.income, expenses: v.expenses });
      }
    }
  });

  res.json({
    openTickets,
    recentAnnouncements,
    totalBalance,
    balanceByBuilding,
    transactionsPerMonth,
  });
});
