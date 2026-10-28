// Shared request parsing for the two price-editing screens. Campaigns and price
// updates take the same selection and the same rules; only the schedule and the
// take-over option differ, so the reading of a submission lives here once.

import {
  APPLY_TO,
  PRICE_ACTION,
  ROUNDING,
  SELECTION_MODE,
} from "./campaign.constants";
import { parseSkuSheet } from "./sku-sheet";

export function readRule(formData) {
  const value = formData.get("value");

  return {
    priceAction: String(formData.get("priceAction") ?? PRICE_ACTION.PERCENTAGE),
    applyTo: String(formData.get("applyTo") ?? APPLY_TO.PRICE),
    value:
      value === null || value === "" ? null : Number.parseFloat(String(value)),
    rounding: String(formData.get("rounding") ?? ROUNDING.NONE),
  };
}

function readIds(formData, field) {
  try {
    const parsed = JSON.parse(String(formData.get(field) ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Which products this run covers. The SKU sheet is parsed here, on the server,
// so the browser and the action never disagree about what it contained.
export function readSelection(formData) {
  const mode = String(formData.get("selectionMode") ?? SELECTION_MODE.PRODUCTS);

  if (mode === SELECTION_MODE.COLLECTIONS) {
    return { mode, collectionIds: readIds(formData, "collectionIds") };
  }

  if (mode === SELECTION_MODE.SKUS) {
    // Parsed once here, and the figure flags travel with the selection so
    // validation does not have to read the sheet a second time.
    const { rows, hasPrices, hasDiscounts } = parseSkuSheet(
      formData.get("skuText"),
    );
    return { mode, rows, hasPrices, hasDiscounts };
  }

  return {
    mode: SELECTION_MODE.PRODUCTS,
    productIds: readIds(formData, "productIds"),
  };
}

/**
 * Everything that would make a run meaningless, checked before any Shopify call
 * is made. Returns an error message, or null when the submission is usable.
 */
export function validateSubmission(rule, selection) {
  if (selection.mode === SELECTION_MODE.COLLECTIONS) {
    if (selection.collectionIds.length === 0) {
      return "Select at least one collection.";
    }
  } else if (selection.mode === SELECTION_MODE.SKUS) {
    if (selection.rows.length === 0) {
      return "Add at least one SKU, by pasting or uploading a sheet.";
    }
  } else if (selection.productIds.length === 0) {
    return "Select at least one product.";
  }

  // Guards against a malformed submission reaching the pricing engine, where an
  // unrecognised action would quietly skip every variant instead of failing.
  if (!Object.values(PRICE_ACTION).includes(rule.priceAction)) {
    return "Choose a price update method.";
  }

  if (
    (rule.priceAction === PRICE_ACTION.MANUAL ||
      rule.priceAction === PRICE_ACTION.PERCENTAGE) &&
    (rule.value === null || Number.isNaN(rule.value))
  ) {
    return "Enter a value for the price rule.";
  }

  // Only a sheet carries per-SKU prices and discounts.
  const isSheetRule =
    rule.priceAction === PRICE_ACTION.FROM_SHEET ||
    rule.priceAction === PRICE_ACTION.SHEET_PERCENTAGE;

  if (isSheetRule && selection.mode !== SELECTION_MODE.SKUS) {
    return "That rule needs products selected by SKU sheet.";
  }

  // A sheet that carries figures is an instruction. Applying a rule that reads
  // from Shopify instead would silently discard what the sheet asked for, so it
  // is refused here as well as being disabled in the form.
  if (
    selection.mode === SELECTION_MODE.SKUS &&
    !isSheetRule &&
    (selection.hasPrices || selection.hasDiscounts)
  ) {
    return "Your sheet supplies prices, so only the sheet-based rules can be used. Remove the price and discount columns to apply a rule to every row instead.";
  }

  return null;
}
