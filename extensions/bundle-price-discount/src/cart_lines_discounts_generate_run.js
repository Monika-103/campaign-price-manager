import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * The app's offer types, worked out at checkout. Which one a discount is
 * comes from its configuration metafield, written by the app:
 *
 * BUNDLE -- "buy N for a fixed price", e.g. any 3 for 55.
 *   { type: "BUNDLE", quantity: 3, bundlePrice: "55.00",
 *     productIds, collectionIds, message }
 *
 * GIFT -- "buy N, get a gift item for a set price", e.g. buy 3, get 1 tote
 *   bag for 1.00, or "spend X, get a gift", e.g. spend 50, get the tote for
 *   1.00.
 *   { type: "GIFT", threshold: "ITEMS" | "SPEND", quantity: 3,
 *     minSpend: "50.00", giftPrice: "1.00", giftProductIds, giftsPerSet: 1,
 *     repeat: false, productIds, collectionIds, message }
 *
 * `productIds` / `collectionIds` are the items that count towards the N
 * bought. Prices in the configuration are in the shop's currency and are
 * converted to the cart's.
 *
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const NO_DISCOUNT = { operations: [] };

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return NO_DISCOUNT;
  }

  const raw = input.discount.metafield?.jsonValue;
  // Discounts made before gifts existed carry no type; they are bundles.
  const type = raw?.type ?? "BUNDLE";

  // The cart may be in the customer's currency, the configuration is in the
  // shop's. Everything is worked in integer cents of the cart's currency.
  const rate = Number.parseFloat(input.presentmentCurrencyRate ?? "1") || 1;

  const perLine =
    type === "GIFT"
      ? giftDiscounts(input.cart.lines, readGiftConfig(raw), rate)
      : bundleDiscounts(input.cart.lines, readBundleConfig(raw), rate);

  if (!perLine || perLine.size === 0) return NO_DISCOUNT;

  const message = typeof raw?.message === "string" ? raw.message : undefined;
  const candidates = [...perLine.entries()].map(([lineId, entry]) => ({
    ...(message ? { message } : {}),
    targets: [{ cartLine: { id: lineId, quantity: entry.quantity } }],
    value: {
      fixedAmount: {
        amount: (entry.cents / 100).toFixed(2),
        // One total for all the targeted items on this line, not per item.
        appliesToEachItem: false,
      },
    },
  }));

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

/**
 * Bundles: qualifying items are lined up from most to least expensive and
 * grouped into sets in that order, so the customer gets the bundle price on
 * their dearest items. Items left over after the last full set pay full
 * price. A set that would already cost less than the bundle price is left
 * alone -- this offer never puts a price up.
 */
function bundleDiscounts(lines, config, rate) {
  if (!config) return null;
  const bundleCents = Math.round(config.bundlePrice * rate * 100);

  const units = [];
  for (const line of lines) {
    if (!qualifies(line, config.productIds)) continue;
    const unitCents = toCents(line.cost.amountPerQuantity.amount);
    for (let count = 0; count < line.quantity; count += 1) {
      units.push({ lineId: line.id, cents: unitCents });
    }
  }

  const bundleCount = Math.floor(units.length / config.quantity);
  if (bundleCount === 0) return null;

  units.sort((a, b) => b.cents - a.cents);

  const perLine = new Map();
  for (let bundle = 0; bundle < bundleCount; bundle += 1) {
    const members = units.slice(
      bundle * config.quantity,
      (bundle + 1) * config.quantity,
    );
    const fullCents = members.reduce((sum, unit) => sum + unit.cents, 0);
    const offCents = fullCents - bundleCents;
    if (offCents <= 0) continue;

    // Spread the saving across the set in proportion to each item's price,
    // with the last item absorbing the rounding so the set lands exactly on
    // the bundle price.
    let remaining = offCents;
    members.forEach((unit, index) => {
      const share =
        index === members.length - 1
          ? remaining
          : Math.round((offCents * unit.cents) / fullCents);
      remaining -= share;
      addTo(perLine, unit.lineId, share);
    });
  }

  return perLine;
}

/**
 * Gifts: for every `quantity` qualifying items bought, up to `giftsPerSet`
 * gift items in the cart drop to the gift price (once per order unless
 * `repeat`). The customer adds the gift themselves; a discount cannot put an
 * item in the cart.
 *
 * A gift unit never counts towards its own purchase: when the gift product is
 * also a qualifying item, only the units left over after the gifts count as
 * bought.
 */
function giftDiscounts(lines, config, rate) {
  if (!config) return null;
  const giftCents = Math.round(config.giftPrice * rate * 100);

  const giftUnits = [];
  let boughtUnits = 0;
  let boughtCents = 0;
  let giftsAlsoQualify = false;

  for (const line of lines) {
    const isGift = isProduct(line, config.giftProductIds);
    const counts = qualifies(line, config.productIds);

    if (isGift) {
      const unitCents = toCents(line.cost.amountPerQuantity.amount);
      for (let count = 0; count < line.quantity; count += 1) {
        giftUnits.push({ lineId: line.id, cents: unitCents });
      }
      if (counts) giftsAlsoQualify = true;
    } else if (counts) {
      boughtUnits += line.quantity;
      boughtCents +=
        toCents(line.cost.amountPerQuantity.amount) * line.quantity;
    }
  }

  if (giftUnits.length === 0) return null;

  // The most gifts the purchase earns, and that are actually in the cart.
  // With an item threshold, gift units that are not discounted can count as
  // bought items, so this steps down from the most gifts possible until the
  // purchase covers them. With a spend threshold, gift items never count
  // towards the spend.
  const maxSets = config.repeat ? Infinity : 1;
  const minSpendCents = Math.round(config.minSpend * rate * 100);
  let gifts = Math.min(giftUnits.length, maxSets * config.giftsPerSet);
  while (gifts > 0) {
    const spareGifts = giftsAlsoQualify ? giftUnits.length - gifts : 0;
    const setsEarned =
      config.threshold === "SPEND"
        ? Math.floor(boughtCents / minSpendCents)
        : Math.floor((boughtUnits + spareGifts) / config.quantity);
    const allowed = Math.min(setsEarned, maxSets) * config.giftsPerSet;
    if (gifts <= allowed) break;
    gifts -= 1;
  }
  if (gifts === 0) return null;

  // The dearest gift units first, so a gift in several variants gives the
  // customer the most it can.
  giftUnits.sort((a, b) => b.cents - a.cents);

  const perLine = new Map();
  for (const unit of giftUnits.slice(0, gifts)) {
    const offCents = unit.cents - giftCents;
    // A gift already at or below the gift price is left as it is.
    if (offCents > 0) addTo(perLine, unit.lineId, offCents);
  }

  return perLine;
}

// Refuse settings that would discount nonsensically rather than guess.
function readBundleConfig(raw) {
  if (!raw || typeof raw !== "object") return null;

  const quantity = Math.floor(Number(raw.quantity));
  const bundlePrice = Number.parseFloat(raw.bundlePrice);
  if (!Number.isFinite(quantity) || quantity < 2) return null;
  if (!Number.isFinite(bundlePrice) || bundlePrice < 0) return null;

  return { quantity, bundlePrice, productIds: idList(raw.productIds) };
}

function readGiftConfig(raw) {
  if (!raw || typeof raw !== "object") return null;

  const threshold = raw.threshold === "SPEND" ? "SPEND" : "ITEMS";
  const quantity = Math.floor(Number(raw.quantity));
  const minSpend = Number.parseFloat(raw.minSpend);
  const giftPrice = Number.parseFloat(raw.giftPrice);
  const giftsPerSet = Math.floor(Number(raw.giftsPerSet ?? 1));
  const giftProductIds = idList(raw.giftProductIds);
  if (threshold === "ITEMS" && (!Number.isFinite(quantity) || quantity < 1)) {
    return null;
  }
  if (threshold === "SPEND" && (!Number.isFinite(minSpend) || minSpend <= 0)) {
    return null;
  }
  if (!Number.isFinite(giftPrice) || giftPrice < 0) return null;
  if (!Number.isFinite(giftsPerSet) || giftsPerSet < 1) return null;
  if (giftProductIds.length === 0) return null;

  return {
    threshold,
    quantity,
    minSpend,
    giftPrice,
    giftsPerSet,
    giftProductIds,
    repeat: raw.repeat === true,
    productIds: idList(raw.productIds),
  };
}

function idList(value) {
  return Array.isArray(value) ? value : [];
}

function isProduct(line, productIds) {
  return (
    line.merchandise.__typename === "ProductVariant" &&
    productIds.includes(line.merchandise.product.id)
  );
}

// Counts towards the purchase: a chosen product, or in a chosen collection.
function qualifies(line, productIds) {
  if (line.merchandise.__typename !== "ProductVariant") return false;
  return (
    productIds.includes(line.merchandise.product.id) ||
    line.merchandise.product.inAnyCollection
  );
}

function addTo(perLine, lineId, cents) {
  const entry = perLine.get(lineId) ?? { cents: 0, quantity: 0 };
  entry.cents += cents;
  entry.quantity += 1;
  perLine.set(lineId, entry);
}

function toCents(amount) {
  return Math.round(Number.parseFloat(amount) * 100);
}
