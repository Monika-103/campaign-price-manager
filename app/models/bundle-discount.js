// Discount helpers that the browser needs too (no database or Shopify calls
// here, so list and detail pages can import them).

import { formatMoney } from "../components/format";

// The offer types the app creates.
export const DISCOUNT_KIND = {
  BUNDLE: "BUNDLE",
  GIFT: "GIFT",
};

export const DISCOUNT_STATUS = {
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
};

export const DISCOUNT_BADGE = {
  SCHEDULED: { label: "Scheduled", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  ENDED: { label: "Ended", tone: "neutral" },
};

export const DISCOUNT_SELECTION = {
  PRODUCTS: "PRODUCTS",
  COLLECTIONS: "COLLECTIONS",
};

// How the customer gets the offer.
export const DISCOUNT_METHOD = {
  AUTOMATIC: "AUTOMATIC",
  CODE: "CODE",
  // A code discount that customers get by opening its discount link rather
  // than by typing the code.
  LINK: "LINK",
};

// CODE and LINK are both code discounts in Shopify.
export function usesCode(method) {
  return method === DISCOUNT_METHOD.CODE || method === DISCOUNT_METHOD.LINK;
}

/**
 * The page a discount link lands on, as a path ("/pages/bundle-offer").
 * Accepts a path or a full store URL; anything else returns null.
 */
export function normaliseLandingPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "/";
  try {
    const url = new URL(raw, "https://store.invalid");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return null;
  }
}

/**
 * The link that switches the discount on and lands on its page, using
 * Shopify's built-in discount links: /discount/CODE?redirect=/path.
 */
export function discountLink(storeUrl, discount) {
  if (!storeUrl || !discount.code) return null;
  const base = storeUrl.replace(/\/$/, "");
  const path = discount.landingPath || "/";
  return `${base}/discount/${encodeURIComponent(discount.code)}?redirect=${encodeURIComponent(path)}`;
}

// What kind of discount each is, as shown on its page.
export const DISCOUNT_KIND_LABEL = {
  BUNDLE: "Bundle price (buy a set for a fixed price)",
  GIFT: "Gift with purchase (buy items, get a gift at a set price)",
};

export function readGiftProduct(discount) {
  try {
    const parsed = JSON.parse(discount.giftProduct ?? "null");
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

// The offer in one line, e.g. "3 for €55.00" or "Buy 3, get Tote Bag for
// €1.00". Used on every screen that lists discounts, so they all agree.
export function describeOffer(discount, currencyCode) {
  if (discount.kind === DISCOUNT_KIND.GIFT) {
    const gift = readGiftProduct(discount)?.title ?? "a gift";
    const repeat = discount.giftRepeats ? " (for every set)" : "";
    const earn =
      discount.giftThreshold === "SPEND"
        ? `Spend ${formatMoney(discount.minSpend, currencyCode)}`
        : `Buy ${discount.quantity}`;
    return `${earn}, get ${gift} for ${formatMoney(discount.giftPrice, currencyCode)}${repeat}`;
  }
  return `${discount.quantity} for ${formatMoney(discount.bundlePrice, currencyCode)}`;
}

export function describeMethod(discount) {
  if (discount.method === DISCOUNT_METHOD.LINK) {
    return `Special link only, landing on ${discount.landingPath || "/"}`;
  }
  return discount.method === DISCOUNT_METHOD.CODE
    ? `Discount code: ${discount.code}`
    : "Automatic (no code needed)";
}

// Codes customers can type without confusion: uppercase letters and digits,
// leaving out 0/O and 1/I.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(prefix = "BUNDLE", length = 6) {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

// The discount's page in the Shopify admin, where it sits alongside the
// store's other discounts. `shopify://admin` links open in the admin itself
// rather than inside the app.
export function shopifyAdminUrl(discount) {
  const numericId = discount.shopifyDiscountId?.split("/").pop();
  return numericId ? `shopify://admin/discounts/${numericId}` : null;
}

// Worked out from the dates rather than stored, because Shopify starts and
// ends the discount by itself -- nothing in the app runs at those moments to
// update a status column.
export function discountStatus(discount, now = new Date()) {
  if (discount.endedAt) return DISCOUNT_STATUS.ENDED;
  if (new Date(discount.startsAt) > now) return DISCOUNT_STATUS.SCHEDULED;
  if (discount.endsAt && new Date(discount.endsAt) <= now) {
    return DISCOUNT_STATUS.ENDED;
  }
  return DISCOUNT_STATUS.ACTIVE;
}

// The chosen products or collections, stored as JSON [{ id, title }].
export function readSelection(discount) {
  try {
    const parsed = JSON.parse(discount.selection ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function describeSelection(discount) {
  const count = readSelection(discount).length;
  const noun =
    discount.selectionMode === DISCOUNT_SELECTION.COLLECTIONS
      ? "collection"
      : "product";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
