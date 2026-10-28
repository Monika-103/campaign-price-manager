import prisma from "../db.server";
import {
  CAMPAIGN_KIND,
  CAMPAIGN_STATUS,
  ITEM_STATUS,
  LOG_LEVEL,
  ROLLBACKABLE_STATUSES,
} from "./campaign.constants";
import { readActor } from "./actor.server";
import { buildPreview } from "./pricing";
import {
  applyVariantPrices,
  clearOriginalPrices,
  resolveSelection,
  saveOriginalPrices,
} from "./shopify.products.server";

/**
 * Variants that another campaign has already discounted, and so must not be
 * touched again.
 *
 * Two sources are consulted because either can be missing. The snapshot
 * metafield lives on the variant in Shopify and survives us losing the
 * database; our own tables catch a campaign whose metafield write failed. A
 * variant flagged by either one is excluded.
 *
 * Letting a second campaign through would be worse than it looks: it would
 * snapshot the already-discounted price as the "original", and the real price
 * would be lost for good.
 */
async function findClaimedVariants(shop, variants, currentCampaignId = null) {
  const claimed = new Map();

  // Source 1: the metafield each variant carries.
  for (const variant of variants) {
    if (!variant.originalPrice) continue;
    if (
      currentCampaignId &&
      variant.originalPrice.campaignId === currentCampaignId
    ) {
      continue;
    }
    claimed.set(variant.variantId, {
      sku: variant.sku,
      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle,
      campaignId: variant.originalPrice.campaignId ?? null,
      campaignName: null,
      originalPrice: variant.originalPrice.price,
      originalCompareAt: variant.originalPrice.compareAtPrice ?? null,
    });
  }

  // Source 2: our own record of what is currently applied.
  //
  // Only campaigns claim a variant. A price update changes the normal price and
  // is expected to be built on top of, so counting one here would mean a
  // product could never be repriced twice.
  const rows = await prisma.campaignItem.findMany({
    where: {
      variantId: { in: variants.map((variant) => variant.variantId) },
      status: ITEM_STATUS.UPDATED,
      campaign: {
        shop,
        kind: CAMPAIGN_KIND.CAMPAIGN,
        status: { in: ROLLBACKABLE_STATUSES },
        ...(currentCampaignId ? { id: { not: currentCampaignId } } : {}),
      },
    },
    include: { campaign: { select: { id: true, name: true } } },
  });

  // Our own record wins over the metafield where both exist: it carries the
  // campaign's name, and it is the row that has to be marked superseded.
  for (const row of rows) {
    claimed.set(row.variantId, {
      sku: row.sku,
      productTitle: row.productTitle,
      variantTitle: row.variantTitle,
      campaignId: row.campaign.id,
      campaignName: row.campaign.name,
      originalPrice: row.originalPrice,
      originalCompareAt: row.originalCompareAt,
    });
  }

  return claimed;
}

/**
 * Work out what a rule would do to the selection without writing anything.
 *
 * Prices are read live, so the preview reflects the store as it is now rather
 * than whatever was cached when the products were picked. The selection may be
 * products, collections or a list of SKUs -- all three resolve to variants.
 */
export async function previewCampaign(
  admin,
  shop,
  rule,
  selection,
  { takeOver = false } = {},
) {
  const {
    variants,
    warnings: selectionWarnings,
    note,
  } = await resolveSelection(admin, selection);

  const claimed = await findClaimedVariants(shop, variants);

  const free = variants.filter((variant) => !claimed.has(variant.variantId));
  const contested = variants.filter((variant) =>
    claimed.has(variant.variantId),
  );

  // Without a take-over, claimed variants are held back before the rule runs,
  // so they never appear in the changes the merchant is asked to confirm.
  const priced = takeOver
    ? [
        ...free,
        ...contested.map((variant) => rebaseToOriginal(variant, claimed)),
      ]
    : free;

  const { changes, skipped, warnings, largeDrops } = buildPreview(rule, priced);

  const conflicts = takeOver ? [] : [...claimed.values()];
  const extraWarnings = [];

  if (conflicts.length > 0) {
    extraWarnings.push(
      `${conflicts.length} variant(s) are already in an active campaign and were left untouched.`,
    );
  }
  if (takeOver && contested.length > 0) {
    extraWarnings.push(
      `${contested.length} variant(s) are being taken over from another campaign. Their new prices are worked out from the original price, not the current discounted one.`,
    );
  }

  return {
    changes,
    skipped,
    conflicts,
    largeDrops,
    takenOverCount: takeOver ? contested.length : 0,
    // Ready-made explanation for the caller to show when `changes` is empty.
    nothingToDo: describeNothingToDo(conflicts, skipped),
    // Warnings about the selection itself (unmatched SKUs, unreadable
    // collections) come first: they explain why something is missing entirely,
    // rather than why a variant was left at its current price.
    warnings: [...selectionWarnings, ...extraWarnings, ...warnings],
    note,
    productCount: new Set(changes.map((change) => change.productId)).size,
  };
}

/**
 * Say why a run produced nothing.
 *
 * "Nothing to change" has three very different causes -- everything is locked
 * by a campaign, the rule could not be applied, or the prices are already
 * right -- and the merchant can only act on the first two if we name them.
 */
function describeNothingToDo(conflicts = [], skipped = []) {
  if (conflicts.length > 0) {
    const names = [
      ...new Set(
        conflicts.map((conflict) => conflict.campaignName).filter(Boolean),
      ),
    ];

    return (
      `All ${conflicts.length} selected variant(s) are already in an active campaign` +
      (names.length > 0 ? ` (${names.map((n) => `"${n}"`).join(", ")})` : "") +
      `, so nothing was changed. Restore that campaign first, or pick different products.`
    );
  }

  if (skipped.length > 0) {
    // Every skip carries a reason; the most common one explains the run best.
    const counts = new Map();
    for (const item of skipped) {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    }
    const [reason] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

    return `No prices changed. ${skipped.length} variant(s) were skipped, most commonly: ${reason.toLowerCase()}.`;
  }

  return "None of the selected products need a price change.";
}

/**
 * Point a contested variant's rule at the price it had before any campaign
 * touched it.
 *
 * This is what stops discounts compounding. Left alone, "20% off" applied to a
 * variant already 20% down would take 20% off the *sale* price and then record
 * that sale price as the original -- so the true price would be lost and every
 * later campaign would cut deeper from a lower base.
 *
 * `livePrice` keeps what the storefront shows today, so the preview can still
 * display the real before-and-after.
 */
function rebaseToOriginal(variant, claimed) {
  const claim = claimed.get(variant.variantId);

  return {
    ...variant,
    price: claim.originalPrice ?? variant.price,
    compareAtPrice: claim.originalCompareAt ?? variant.compareAtPrice,
    livePrice: variant.price,
    liveCompareAtPrice: variant.compareAtPrice,
    takenOverFrom: claim.campaignId ?? null,
  };
}

/**
 * Create a campaign: apply it now, or save it to start later.
 *
 * A start time in the future saves the campaign as SCHEDULED without touching
 * a single price. The selection is checked straight away, so the merchant hears
 * about an empty or fully-claimed selection now rather than at start time, but
 * the prices themselves are worked out again when it starts. A price, or
 * another campaign, may change in the meantime, and the snapshot has to be the
 * price the product really had at the moment the offer began.
 */
export async function createAndApplyCampaign(admin, shop, input) {
  const rule = ruleOf(input);
  const actor = readActor(input.session);

  if (input.startAt > new Date()) {
    return scheduleCampaign(admin, shop, input, rule, actor);
  }

  return applyCampaign(admin, shop, {
    rule,
    selection: input.selection,
    takeOver: input.takeOver,
    actor,
    details: {
      name: input.name,
      description: input.description || null,
      startAt: input.startAt,
      endAt: input.endAt,
    },
  });
}

function ruleOf(source) {
  return {
    priceAction: source.priceAction,
    applyTo: source.applyTo,
    value: source.value,
    rounding: source.rounding,
  };
}

async function scheduleCampaign(admin, shop, input, rule, actor) {
  const preview = await previewCampaign(admin, shop, rule, input.selection, {
    takeOver: input.takeOver,
  });

  if (preview.changes.length === 0) {
    return { error: describeNothingToDo(preview.conflicts, preview.skipped) };
  }

  const campaign = await prisma.campaign.create({
    data: {
      shop,
      name: input.name,
      description: input.description || null,
      status: CAMPAIGN_STATUS.SCHEDULED,
      startAt: input.startAt,
      endAt: input.endAt,
      ...rule,
      selectionMode: input.selection.mode,
      selectionNote: preview.note,
      selectionData: JSON.stringify(input.selection),
      takeOver: Boolean(input.takeOver),
      ...actor,
      productCount: preview.productCount,
      variantCount: preview.changes.length,
      logs: {
        create: {
          ...actor,
          level: LOG_LEVEL.INFO,
          message: `Scheduled with ${preview.changes.length} variant(s). No prices change until the start time, when they are worked out again from the live prices.`,
        },
      },
    },
  });

  return { campaign, scheduled: true };
}

/**
 * Start a SCHEDULED campaign whose start time has arrived.
 *
 * Called by the scheduler with an offline admin client, so nobody is signed
 * in: the lines it writes carry no actor, and the change log shows them as the
 * app acting on the schedule the merchant set.
 */
export async function startScheduledCampaign(admin, campaign) {
  // Claimed with a conditional update, so two overlapping scheduler ticks can
  // never start the same campaign twice.
  const claimed = await prisma.campaign.updateMany({
    where: { id: campaign.id, status: CAMPAIGN_STATUS.SCHEDULED },
    data: { status: CAMPAIGN_STATUS.DRAFT },
  });
  if (claimed.count === 0) return { skipped: true };

  const failStart = async (message) => {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: CAMPAIGN_STATUS.FAILED,
        logs: { create: { level: LOG_LEVEL.ERROR, message } },
      },
    });
    return { error: message };
  };

  // The whole window went by while the app was not running. Starting now
  // would put a sale live after the merchant wanted it over.
  if (campaign.endAt && campaign.endAt <= new Date()) {
    return failStart(
      "Did not start: its end time had already passed, so no prices were changed.",
    );
  }

  let selection = null;
  try {
    selection = JSON.parse(campaign.selectionData ?? "null");
  } catch {
    selection = null;
  }
  if (!selection) {
    return failStart(
      "Did not start: the saved product selection could not be read, so no prices were changed.",
    );
  }

  try {
    return await applyCampaign(admin, campaign.shop, {
      rule: ruleOf(campaign),
      selection,
      takeOver: campaign.takeOver,
      actor: { actorName: null, actorEmail: null },
      existing: campaign,
    });
  } catch (error) {
    // Anything already pushed is recorded against its item, and FAILED can be
    // restored, so the merchant is never left without a way back.
    return failStart(`Could not start on schedule: ${error.message}`);
  }
}

/**
 * Work out the prices and push them to Shopify, for a new campaign or for a
 * scheduled one whose start time has come.
 *
 * Every variant's original price is recorded twice before anything is changed:
 * in our own tables, and as a metafield on the variant itself. Both are written
 * *before* the price update, so an interrupted run is still rollbackable and
 * the snapshot never depends on the update succeeding.
 */
async function applyCampaign(
  admin,
  shop,
  { rule, selection, takeOver, actor, details, existing },
) {
  const { changes, skipped, warnings, note, conflicts } = await previewCampaign(
    admin,
    shop,
    rule,
    selection,
    { takeOver },
  );

  if (changes.length === 0) {
    const error = describeNothingToDo(conflicts, skipped);

    if (existing) {
      await prisma.campaign.update({
        where: { id: existing.id },
        data: {
          status: CAMPAIGN_STATUS.FAILED,
          logs: {
            create: {
              level: LOG_LEVEL.ERROR,
              message: `Did not start on schedule. ${error}`,
            },
          },
        },
      });
    }

    return { error };
  }

  // Release the variants from their previous campaign before claiming them, so
  // no variant is ever recorded as live in two campaigns at once.
  const takenOver = changes.filter((change) => change.takenOverFrom);
  if (takenOver.length > 0) {
    await supersedePreviousItems(
      shop,
      takenOver.map((change) => change.variantId),
    );
  }

  const productCount = new Set(changes.map((change) => change.productId)).size;

  const items = {
    create: changes.map((change) => ({
      productId: change.productId,
      variantId: change.variantId,
      productTitle: change.productTitle,
      variantTitle: change.variantTitle,
      sku: change.sku,
      originalPrice: change.price,
      originalCompareAt: change.compareAtPrice,
      newPrice: change.newPrice,
      newCompareAt: change.newCompareAtPrice,
      status: ITEM_STATUS.PENDING,
    })),
  };

  const logs = {
    create: [
      {
        level: LOG_LEVEL.INFO,
        message: existing
          ? `Start time reached. Working on ${changes.length} variant(s) across ${productCount} product(s).`
          : `Campaign created with ${changes.length} variant(s) across ${productCount} product(s).`,
      },
      // Capped: a large campaign could otherwise write thousands of
      // near-identical skip lines.
      ...skipped.slice(0, 20).map((item) => ({
        level: LOG_LEVEL.WARNING,
        message: `Skipped ${item.productTitle}: ${item.reason}`,
      })),
      ...warnings.map((warning) => ({
        level: LOG_LEVEL.WARNING,
        message: warning,
      })),
      // Named individually so the merchant can see exactly which products
      // this campaign did not cover, and why.
      ...conflicts.slice(0, 20).map((conflict) => ({
        level: LOG_LEVEL.WARNING,
        message: `Left untouched, already in ${
          conflict.campaignName ?? "another campaign"
        }: ${conflict.productTitle}${conflict.sku ? ` (${conflict.sku})` : ""}`,
      })),
      ...(takenOver.length > 0
        ? [
            {
              level: LOG_LEVEL.INFO,
              message: `Took ${takenOver.length} variant(s) over from another campaign. Their prices were calculated from the original price, and this campaign now restores them.`,
            },
          ]
        : []),
      // Every line here comes from the same request, so all of them are
      // attributed to whoever submitted it.
    ].map((log) => ({ ...log, ...actor })),
  };

  const campaign = existing
    ? await prisma.campaign.update({
        where: { id: existing.id },
        data: {
          status: CAMPAIGN_STATUS.DRAFT,
          selectionNote: note,
          productCount,
          variantCount: changes.length,
          items,
          logs,
        },
      })
    : await prisma.campaign.create({
        data: {
          shop,
          ...details,
          status: CAMPAIGN_STATUS.DRAFT,
          ...rule,
          selectionMode: selection.mode,
          selectionNote: note,
          ...actor,
          productCount,
          variantCount: changes.length,
          items,
          logs,
        },
      });

  // Written before the prices change, so the variant carries what it should be
  // restored to even if the update below fails partway.
  const snapshot = await saveOriginalPrices(admin, changes, campaign.id);

  if (snapshot.failed.length > 0) {
    await prisma.campaignLog.create({
      data: {
        campaignId: campaign.id,
        ...actor,
        level: LOG_LEVEL.WARNING,
        message: `Could not save the original price to Shopify for some variants: ${snapshot.failed[0]}. The prices are still recorded here, so rollback works.`,
      },
    });
  }

  const result = await pushPrices(admin, campaign.id, changes, {
    price: (change) => change.newPrice,
    compareAtPrice: (change) => change.newCompareAtPrice,
    successStatus: ITEM_STATUS.UPDATED,
  });

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status:
        result.failed.length === 0
          ? CAMPAIGN_STATUS.ACTIVE
          : CAMPAIGN_STATUS.FAILED,
      updatedCount: result.succeeded.length,
      failedCount: result.failed.length,
      appliedAt: new Date(),
      logs: {
        create: {
          ...actor,
          level:
            result.failed.length === 0 ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR,
          message:
            result.failed.length === 0
              ? `Applied new prices to ${result.succeeded.length} variant(s).`
              : `Applied ${result.succeeded.length} variant(s); ${result.failed.length} failed.`,
        },
      },
    },
  });

  return { campaign: updated, skippedCount: skipped.length };
}

/**
 * Hand the given variants over from whichever campaign currently holds them.
 *
 * The old rows keep their recorded prices for history but move to SUPERSEDED,
 * which takes them out of that campaign's rollback: only the campaign that
 * holds a variant now is allowed to restore it.
 */
async function supersedePreviousItems(shop, variantIds) {
  const rows = await prisma.campaignItem.findMany({
    where: {
      variantId: { in: variantIds },
      status: ITEM_STATUS.UPDATED,
      campaign: { shop, status: { in: ROLLBACKABLE_STATUSES } },
    },
    select: { id: true, campaignId: true },
  });

  if (rows.length === 0) return;

  await prisma.campaignItem.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { status: ITEM_STATUS.SUPERSEDED },
  });

  // Each affected campaign now controls fewer variants than it did.
  const countByCampaign = new Map();
  for (const row of rows) {
    countByCampaign.set(
      row.campaignId,
      (countByCampaign.get(row.campaignId) ?? 0) + 1,
    );
  }

  for (const [campaignId, count] of countByCampaign) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        updatedCount: { decrement: count },
        logs: {
          create: {
            level: LOG_LEVEL.WARNING,
            message: `${count} variant(s) were taken over by a newer campaign and will no longer be restored by this one.`,
          },
        },
      },
    });
  }
}

/**
 * Put every variant in the campaign back to the price recorded when it was
 * applied. Only items that actually reached Shopify are restored.
 *
 * `reason: "end"` marks a restore the scheduler started because the campaign's
 * end time passed; it runs without a session, so it carries no actor.
 */
export async function rollbackCampaign(
  admin,
  shop,
  campaignId,
  session,
  { reason } = {},
) {
  const actor = readActor(session);
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
    include: { items: { where: { status: ITEM_STATUS.UPDATED } } },
  });

  const isPriceUpdate = campaign?.kind === CAMPAIGN_KIND.PRICE_UPDATE;
  const noun = isPriceUpdate ? "price update" : "campaign";

  if (!campaign) {
    return { error: "Not found." };
  }

  // A scheduled campaign has not changed any price yet, so "restoring" it just
  // means calling it off. Conditional, in case the scheduler is starting it at
  // this very moment -- then it is no longer SCHEDULED and is restored below
  // on the next attempt instead.
  if (campaign.status === CAMPAIGN_STATUS.SCHEDULED) {
    const cancelled = await prisma.campaign.updateMany({
      where: { id: campaign.id, status: CAMPAIGN_STATUS.SCHEDULED },
      data: { status: CAMPAIGN_STATUS.ROLLED_BACK, rolledBackAt: new Date() },
    });

    if (cancelled.count === 0) {
      return {
        error:
          "This campaign is starting right now. Wait a moment, then restore its prices.",
      };
    }

    await prisma.campaignLog.create({
      data: {
        campaignId: campaign.id,
        ...actor,
        level: LOG_LEVEL.INFO,
        message: "Cancelled before it started. No prices were changed.",
      },
    });

    return { cancelled: true, restoredCount: 0 };
  }

  // A run left mid-restore can be picked up again. This happens when the
  // request is cut short -- restoring hundreds of variants takes many calls to
  // Shopify -- after the prices are back but before the status was written.
  const isResuming = campaign.status === CAMPAIGN_STATUS.ROLLING_BACK;

  if (!isResuming && !ROLLBACKABLE_STATUSES.includes(campaign.status)) {
    return {
      error: `A ${campaign.status.toLowerCase()} ${noun} cannot be undone.`,
    };
  }

  if (campaign.items.length === 0) {
    // Nothing left to restore. If we were mid-restore, every variant is
    // already back, so finish the job rather than reporting an error.
    if (isResuming) {
      const settled = await finishRollback(
        campaign.id,
        { succeeded: [], failed: [] },
        actor,
      );
      return { campaign: settled, restoredCount: 0 };
    }

    return { error: `This ${noun} has no applied prices to restore.` };
  }

  // Claimed with a conditional update, so a merchant pressing restore while
  // the scheduler ends the same campaign cannot push the prices back twice.
  // Logged before any price moves, so a restore that is cut off partway still
  // leaves a record of who started it and how much it set out to do.
  const started = await prisma.campaign.updateMany({
    where: { id: campaign.id, status: campaign.status },
    data: { status: CAMPAIGN_STATUS.ROLLING_BACK },
  });
  if (started.count === 0 && !isResuming) {
    return { error: `This ${noun} is already being restored.` };
  }

  await prisma.campaignLog.create({
    data: {
      campaignId: campaign.id,
      ...actor,
      level: LOG_LEVEL.INFO,
      message:
        reason === "end"
          ? `End time reached. Restoring original prices for ${campaign.items.length} variant(s).`
          : `Started restoring original prices for ${campaign.items.length} variant(s).`,
    },
  });

  const result = await pushPrices(admin, campaign.id, campaign.items, {
    price: (item) => item.originalPrice,
    compareAtPrice: (item) => item.originalCompareAt,
    successStatus: ITEM_STATUS.RESTORED,
  });

  // Settle the status *before* the metafield cleanup. The cleanup is tidying,
  // not part of getting the prices back, and doing it first is what left runs
  // stranded in ROLLING_BACK when a long request was cut off.
  const restored = await finishRollback(
    campaign.id,
    result,
    actor,
    campaign.items,
  );

  // Release the variants now their prices are actually back. A price update
  // never wrote a snapshot, so there is nothing to release.
  if (result.succeeded.length > 0 && !isPriceUpdate) {
    await clearOriginalPrices(admin, result.succeeded);
  }

  return { campaign: restored, restoredCount: result.succeeded.length };
}

/**
 * Whether this session may delete a run.
 *
 * "Admin" here means the store's account owner, which is what the session tells
 * us. Distinguishing other staff by their permissions would need the
 * `read_users` scope, which is restricted, so ownership is the line we can draw
 * honestly. Collaborators are never allowed.
 */
export function canDelete(session) {
  return Boolean(session?.accountOwner) && !session?.collaborator;
}

/**
 * Permanently remove a run and its history.
 *
 * Refused while any of its prices are still live. Deleting then would leave
 * those products sitting at a campaign price with the only record of their
 * original price destroyed -- unrecoverable. Restore first, then delete.
 */
export async function deleteCampaign(shop, campaignId, session) {
  if (!canDelete(session)) {
    return {
      error:
        "Only the store owner can delete a run. Ask them to do it, or restore the prices instead.",
    };
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
    include: {
      items: { where: { status: ITEM_STATUS.UPDATED }, select: { id: true } },
    },
  });

  if (!campaign) {
    return { error: "Not found." };
  }

  const noun =
    campaign.kind === CAMPAIGN_KIND.PRICE_UPDATE ? "price update" : "campaign";

  if (campaign.items.length > 0) {
    return {
      error: `${campaign.items.length} product(s) still use this ${noun}'s prices. Restore them first — deleting now would leave those prices with no record of what they were before.`,
    };
  }

  // Items and logs are removed with it by the cascade on the relation.
  await prisma.campaign.delete({ where: { id: campaign.id } });

  return { deleted: campaign.name, kind: campaign.kind };
}

/**
 * Take one variant out of a running campaign.
 *
 * Its price goes back to what it was before the campaign, the campaign keeps
 * running for everything else, and the variant is released so a later campaign
 * can pick it up. Useful when one product in a sale turns out to be wrong and
 * you do not want to undo the other forty-nine.
 */
export async function removeItemFromCampaign(
  admin,
  shop,
  campaignId,
  itemId,
  session,
) {
  const actor = readActor(session);

  const item = await prisma.campaignItem.findFirst({
    where: { id: itemId, campaignId, campaign: { shop } },
    include: { campaign: { select: { id: true, kind: true, status: true } } },
  });

  if (!item) {
    return { error: "That product is not part of this run." };
  }
  if (item.status !== ITEM_STATUS.UPDATED) {
    return {
      error: `This product is already ${item.status.toLowerCase()} and cannot be removed again.`,
    };
  }

  const result = await pushPrices(admin, campaignId, [item], {
    price: (entry) => entry.originalPrice,
    compareAtPrice: (entry) => entry.originalCompareAt,
    successStatus: ITEM_STATUS.RESTORED,
  });

  if (result.failed.length > 0) {
    return {
      error: `Could not restore that product: ${result.failed[0].message}`,
    };
  }

  // Release the snapshot so a later campaign no longer sees this variant as
  // claimed. A price update never wrote one.
  if (item.campaign.kind !== CAMPAIGN_KIND.PRICE_UPDATE) {
    await clearOriginalPrices(admin, [item.variantId]);
  }

  const label = `${item.productTitle}${item.sku ? ` (${item.sku})` : ""}`;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      // The campaign now covers one fewer variant.
      updatedCount: { decrement: 1 },
      logs: {
        create: {
          ...actor,
          level: LOG_LEVEL.INFO,
          message: `Removed ${label} from this run and put its price back to ${item.originalPrice}.`,
        },
      },
    },
  });

  return { removed: label };
}

/**
 * Write the final state of a restore.
 *
 * Split out so a run interrupted partway can be settled on its own, without
 * repeating price writes that already happened.
 */
async function finishRollback(campaignId, result, actor, items = []) {
  const failed = result.failed.length;
  const succeeded = result.succeeded.length;

  // Name each variant that stayed at the campaign price, and why, so the log
  // says exactly what still needs attention. Capped like the skip lines: a
  // whole batch failing for one reason would otherwise write hundreds of rows.
  const labelOf = new Map(
    items.map((item) => [
      item.variantId,
      `${item.productTitle}${item.sku ? ` (${item.sku})` : ""}`,
    ]),
  );
  const failureLines = result.failed.slice(0, 20).map((failure) => ({
    ...actor,
    level: LOG_LEVEL.ERROR,
    message: `Could not restore ${
      labelOf.get(failure.variantId) ?? failure.variantId
    }: ${failure.message}`,
  }));

  return prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status:
        failed === 0 ? CAMPAIGN_STATUS.ROLLED_BACK : CAMPAIGN_STATUS.FAILED,
      rolledBackAt: new Date(),
      logs: {
        create: [
          ...failureLines,
          {
            ...actor,
            level: failed === 0 ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR,
            message:
              failed === 0
                ? succeeded > 0
                  ? `Restored original prices for ${succeeded} variant(s).`
                  : "Finished a restore that had been interrupted. All prices were already back."
                : `Restored ${succeeded} variant(s); ${failed} failed.`,
          },
        ],
      },
    },
  });
}

/**
 * Shared write path for applying and rolling back: send the prices, then mark
 * each item with what actually happened to it.
 */
async function pushPrices(
  admin,
  campaignId,
  items,
  { price, compareAtPrice, successStatus },
) {
  const updates = items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    price: price(item),
    compareAtPrice: compareAtPrice(item),
  }));

  const result = await applyVariantPrices(admin, updates);

  if (result.succeeded.length > 0) {
    await prisma.campaignItem.updateMany({
      where: { campaignId, variantId: { in: result.succeeded } },
      data: { status: successStatus, error: null },
    });
  }

  // Errors are usually shared across a whole batch, so group by message to keep
  // the write count proportional to the failure modes, not the variants.
  const byMessage = new Map();
  for (const failure of result.failed) {
    const existing = byMessage.get(failure.message);
    if (existing) {
      existing.push(failure.variantId);
    } else {
      byMessage.set(failure.message, [failure.variantId]);
    }
  }

  for (const [message, variantIds] of byMessage) {
    await prisma.campaignItem.updateMany({
      where: { campaignId, variantId: { in: variantIds } },
      data: { status: ITEM_STATUS.FAILED, error: message },
    });
  }

  return result;
}
