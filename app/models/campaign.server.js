import prisma from "../db.server";
import {
  CAMPAIGN_KIND,
  CAMPAIGN_STATUS,
  ITEM_STATUS,
  ROLLBACKABLE_STATUSES,
} from "./campaign.constants";
import { DISCOUNT_STATUS, discountStatus } from "./bundle-discount";

/**
 * Tiles and recent rows for the dashboard, in one round trip.
 *
 * Every query in this file is scoped to `shop` -- none may ever span shops.
 * Runs left over from the removed price-update feature are kept in the
 * database but are not listed here.
 */
export async function getDashboardData(shop, { recentLimit = 5 } = {}) {
  const campaigns = { shop, kind: CAMPAIGN_KIND.CAMPAIGN };

  const [
    statusCounts,
    totals,
    recentCampaigns,
    discounts,
    discountedNow,
    needsAttention,
    activity,
  ] = await Promise.all([
    prisma.campaign.groupBy({
      by: ["status"],
      where: campaigns,
      _count: { _all: true },
    }),
    prisma.campaign.aggregate({
      // Every run the app has made: "how much has this app changed", not "how
      // many offers are running".
      where: { shop },
      _sum: { updatedCount: true },
    }),
    prisma.campaign.findMany({
      where: campaigns,
      orderBy: { createdAt: "desc" },
      take: recentLimit,
    }),
    // All of them, not just the recent few: the live count is worked out from
    // their dates, since Shopify starts and ends them itself.
    prisma.bundleDiscount.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    // Variants whose price is currently held by a campaign.
    prisma.campaignItem.count({
      where: {
        status: ITEM_STATUS.UPDATED,
        campaign: {
          shop,
          kind: CAMPAIGN_KIND.CAMPAIGN,
          status: { in: ROLLBACKABLE_STATUSES },
        },
      },
    }),
    prisma.campaign.findMany({
      where: { ...campaigns, failedCount: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.campaignLog.findMany({
      where: { campaign: { shop } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { campaign: { select: { id: true, name: true, kind: true } } },
    }),
  ]);

  const byStatus = Object.fromEntries(
    statusCounts.map((row) => [row.status, row._count._all]),
  );

  return {
    stats: {
      active: byStatus[CAMPAIGN_STATUS.ACTIVE] ?? 0,
      scheduled: byStatus[CAMPAIGN_STATUS.SCHEDULED] ?? 0,
      completed: byStatus[CAMPAIGN_STATUS.COMPLETED] ?? 0,
      productsUpdated: totals._sum.updatedCount ?? 0,
      activeDiscounts: discounts.filter(
        (discount) => discountStatus(discount) === DISCOUNT_STATUS.ACTIVE,
      ).length,
      discountedNow,
    },
    recentCampaigns,
    recentDiscounts: discounts.slice(0, recentLimit),
    needsAttention,
    activity,
  };
}

export async function listCampaigns(shop, kind = CAMPAIGN_KIND.CAMPAIGN) {
  return prisma.campaign.findMany({
    where: { shop, kind },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(shop, id) {
  return prisma.campaign.findFirst({
    where: { id, shop },
    include: {
      items: { orderBy: { productTitle: "asc" } },
      logs: { orderBy: { createdAt: "desc" } },
    },
  });
}

/**
 * The change log: every recorded action across campaigns and price updates,
 * newest first, with the person who made it.
 *
 * Entries the app wrote on its own behalf have no actor, which is why the
 * column can be empty rather than wrong.
 */
export async function listChangeLog(shop, { limit = 100, actorEmail } = {}) {
  return prisma.campaignLog.findMany({
    where: {
      campaign: { shop },
      ...(actorEmail ? { actorEmail } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      campaign: { select: { id: true, name: true, kind: true } },
    },
  });
}

/** Distinct people who have made a change, for the log's filter. */
export async function listActors(shop) {
  const rows = await prisma.campaignLog.findMany({
    where: { campaign: { shop }, actorEmail: { not: null } },
    distinct: ["actorEmail"],
    select: { actorName: true, actorEmail: true },
    orderBy: { actorEmail: "asc" },
  });

  return rows;
}
