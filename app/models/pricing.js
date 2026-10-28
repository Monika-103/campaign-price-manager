import { APPLY_TO, PRICE_ACTION, ROUNDING } from "./campaign.constants";

// Money is handled as integer cents throughout this module. Shopify returns
// prices as decimal strings ("24.99"), so each value is parsed on the way in
// and formatted on the way out -- floats are never multiplied directly.

export function toCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function toMoney(cents) {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toFixed(2);
}

function applyRounding(cents, rounding) {
  if (cents === null) return null;

  switch (rounding) {
    // 2239 -> 2199, 1999 -> 1999. Rounds to the nearest whole unit then drops
    // a cent, which is what ".99" charm pricing expects.
    case ROUNDING.END_99: {
      const whole = Math.round(cents / 100) * 100;
      return Math.max(whole - 1, 0);
    }
    case ROUNDING.END_95: {
      const whole = Math.round(cents / 100) * 100;
      return Math.max(whole - 5, 0);
    }
    case ROUNDING.WHOLE:
      return Math.round(cents / 100) * 100;
    case ROUNDING.NONE:
    default:
      return cents;
  }
}

function discount(cents, percentage) {
  if (cents === null) return null;
  const pct = Number.parseFloat(String(percentage ?? 0));
  if (!Number.isFinite(pct) || pct === 0) return cents;
  return Math.round(cents * (1 - pct / 100));
}

/**
 * Work out what one variant's prices become under a campaign's rule.
 *
 * Returns `skipped` and `reason` alongside the new values so the caller can
 * tell the merchant exactly which variants a rule could not be applied to --
 * for example a compare-at rule on a variant with no compare-at price --
 * rather than dropping them silently.
 *
 * @param {{priceAction: string, applyTo?: string, value?: number, rounding?: string}} rule
 * @param {{price: string, compareAtPrice?: string|null}} variant
 */
export function calculateNewPrices(rule, variant) {
  const {
    priceAction,
    applyTo = APPLY_TO.PRICE,
    value,
    rounding = ROUNDING.NONE,
  } = rule;

  const price = toCents(variant.price);
  const compareAt = toCents(variant.compareAtPrice);

  const unchanged = {
    price: toMoney(price),
    compareAtPrice: toMoney(compareAt),
    skipped: true,
    reason: null,
    warning: null,
  };

  if (price === null) {
    return { ...unchanged, reason: "Variant has no price" };
  }

  switch (priceAction) {
    // Set one field to a fixed amount and leave the other alone.
    case PRICE_ACTION.MANUAL: {
      const amount = toCents(value);
      if (amount === null) {
        return { ...unchanged, reason: "No price entered" };
      }
      if (applyTo === APPLY_TO.COMPARE_AT) {
        return {
          price: toMoney(price),
          compareAtPrice: toMoney(amount),
          skipped: amount === compareAt,
          reason: null,
          warning: null,
        };
      }
      return {
        price: toMoney(amount),
        compareAtPrice: toMoney(compareAt),
        skipped: amount === price,
        reason: null,
        warning: null,
      };
    }

    // Take a percentage off the source field. `applyTo` selects which field the
    // discount is calculated *from*; the result is always the selling price.
    case PRICE_ACTION.PERCENTAGE: {
      const source = applyTo === APPLY_TO.COMPARE_AT ? compareAt : price;
      if (source === null) {
        return { ...unchanged, reason: "Variant has no compare-at price" };
      }
      const next = applyRounding(discount(source, value), rounding);
      return {
        price: toMoney(next),
        compareAtPrice: toMoney(compareAt),
        skipped: next === price,
        reason: null,
        warning: null,
      };
    }

    // Promote the current selling price into compare-at so the storefront shows
    // a strikethrough, then discount it for the new selling price.
    case PRICE_ACTION.SELLING_TO_COMPARE: {
      const next = applyRounding(discount(price, value), rounding);
      return {
        price: toMoney(next),
        compareAtPrice: toMoney(price),
        skipped: false,
        reason: null,
        warning:
          compareAt !== null && compareAt !== price
            ? "Existing compare-at price will be overwritten"
            : null,
      };
    }

    // Keep compare-at as the anchor and derive the selling price from it.
    case PRICE_ACTION.COMPARE_TO_SELLING: {
      if (compareAt === null) {
        return { ...unchanged, reason: "Variant has no compare-at price" };
      }
      const next = applyRounding(discount(compareAt, value), rounding);
      return {
        price: toMoney(next),
        compareAtPrice: toMoney(compareAt),
        skipped: next === price,
        reason: null,
        warning:
          next > compareAt
            ? "New price is higher than the compare-at price"
            : null,
      };
    }

    // Both prices come straight from the uploaded sheet, per SKU. A blank cell
    // means "leave this field alone", so a sheet that only fills in RRP does
    // not wipe every selling price.
    case PRICE_ACTION.FROM_SHEET: {
      const sheetPrice = toCents(variant.sheetPrice);
      const sheetCompareAt = toCents(variant.sheetCompareAt);

      if (sheetPrice === null && sheetCompareAt === null) {
        return { ...unchanged, reason: "No price in the sheet for this SKU" };
      }

      const nextPrice = sheetPrice ?? price;
      const nextCompareAt = sheetCompareAt ?? compareAt;

      return {
        price: toMoney(nextPrice),
        compareAtPrice: toMoney(nextCompareAt),
        skipped: nextPrice === price && nextCompareAt === compareAt,
        reason: null,
        warning:
          nextCompareAt !== null && nextPrice > nextCompareAt
            ? "Sheet price is higher than the sheet RRP"
            : null,
      };
    }

    // Each row carries its own discount, so one sheet can cut different SKUs by
    // different amounts.
    //
    // The discount is taken off the sheet's own RRP when the row has one, and
    // off the variant's current price otherwise. Using the row's RRP matters:
    // it means the result does not depend on what the store's price happens to
    // be today, so re-running the same sheet always lands on the same number.
    case PRICE_ACTION.SHEET_PERCENTAGE: {
      const percent = variant.sheetDiscount;

      if (percent === null || percent === undefined) {
        return {
          ...unchanged,
          reason: "No discount in the sheet for this SKU",
        };
      }

      const sheetCompareAt = toCents(variant.sheetCompareAt);
      const source = sheetCompareAt ?? price;
      const next = applyRounding(discount(source, percent), rounding);

      return {
        price: toMoney(next),
        // A sheet RRP becomes the compare-at, so the storefront shows what the
        // discount was taken off.
        compareAtPrice: toMoney(sheetCompareAt ?? compareAt),
        skipped: next === price && (sheetCompareAt ?? compareAt) === compareAt,
        reason: null,
        warning: null,
      };
    }

    default:
      return { ...unchanged, reason: `Unknown price action: ${priceAction}` };
  }
}

// A new price this far below the current one is more often a bad export or a
// shifted column than a real promotion, so the preview calls it out.
const LARGE_DROP_RATIO = 0.5;

/**
 * Run a rule across a list of variants, splitting them into the ones that will
 * change and the ones that cannot be touched. Both the preview screen and the
 * apply step call this, so what the merchant confirms is what actually runs.
 */
export function buildPreview(rule, variants) {
  const changes = [];
  const skipped = [];
  const warnings = new Set();

  for (const variant of variants) {
    const result = calculateNewPrices(rule, variant);

    if (result.warning) warnings.add(result.warning);

    if (result.reason) {
      skipped.push({ ...variant, reason: result.reason });
      continue;
    }
    if (result.skipped) {
      skipped.push({ ...variant, reason: "Price is already up to date" });
      continue;
    }

    changes.push({
      ...variant,
      newPrice: result.price,
      newCompareAtPrice: result.compareAtPrice,
    });
  }

  return {
    changes,
    skipped,
    warnings: [...warnings],
    ...findLargeDrops(changes),
  };
}

/**
 * Pick out rows whose price falls by more than half.
 *
 * These are still applied -- a genuine clearance looks exactly like this -- but
 * they are surfaced first, because the same shape is what a shifted column or a
 * misplaced decimal produces, and a sheet can carry that mistake across
 * hundreds of products at once.
 */
function findLargeDrops(changes) {
  const largeDrops = [];

  for (const change of changes) {
    const before = toCents(change.price);
    const after = toCents(change.newPrice);

    if (before === null || after === null || before === 0) continue;
    if (after > before * LARGE_DROP_RATIO) continue;

    largeDrops.push({
      productTitle: change.productTitle,
      sku: change.sku,
      price: change.price,
      newPrice: change.newPrice,
      percent: Math.round((1 - after / before) * 100),
    });
  }

  return { largeDrops };
}
