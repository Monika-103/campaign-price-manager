// Allowed values for the string columns on Campaign and CampaignItem.
// SQLite has no enums, so these are the single source of truth.

// A campaign is a temporary offer that gets restored. A price update is a
// permanent change to the normal price -- it is undoable, but it is never an
// active offer, so it does not claim variants or block campaigns.
export const CAMPAIGN_KIND = {
  CAMPAIGN: "CAMPAIGN",
  PRICE_UPDATE: "PRICE_UPDATE",
};

// Statuses a completed price update can be in. It has no schedule, so it is
// either applied or undone.
export const PRICE_UPDATE_STATUS = {
  APPLIED: "ACTIVE",
  UNDONE: "ROLLED_BACK",
};

export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  ROLLING_BACK: "ROLLING_BACK",
  ROLLED_BACK: "ROLLED_BACK",
  FAILED: "FAILED",
};

export const PRICE_ACTION = {
  // Set an explicit amount on every selected variant.
  MANUAL: "MANUAL",
  // Take a percentage off the source field.
  PERCENTAGE: "PERCENTAGE",
  // Move the current selling price up into compare-at, then discount it.
  SELLING_TO_COMPARE: "SELLING_TO_COMPARE",
  // Derive the new selling price from the existing compare-at price.
  COMPARE_TO_SELLING: "COMPARE_TO_SELLING",
  // Take both prices verbatim from the uploaded sheet, per SKU.
  FROM_SHEET: "FROM_SHEET",
  // Apply each row's own discount percentage from the sheet.
  SHEET_PERCENTAGE: "SHEET_PERCENTAGE",
};

export const PRICE_ACTION_LABEL = {
  MANUAL: "Set manual price",
  PERCENTAGE: "Percentage discount",
  SELLING_TO_COMPARE: "Use selling price as compare-at price",
  COMPARE_TO_SELLING: "Use compare-at price to set selling price",
  FROM_SHEET: "Use the prices in the sheet",
  SHEET_PERCENTAGE: "Use the discount % in the sheet",
};

// Which field a MANUAL or PERCENTAGE rule calculates from.
export const APPLY_TO = {
  PRICE: "PRICE",
  COMPARE_AT: "COMPARE_AT",
};

// How the merchant picked the products a campaign applies to.
export const SELECTION_MODE = {
  // Individual products chosen in the resource picker.
  PRODUCTS: "PRODUCTS",
  // Every product in one or more collections.
  COLLECTIONS: "COLLECTIONS",
  // Specific variants matched by SKU, pasted or uploaded as a sheet.
  SKUS: "SKUS",
};

export const SELECTION_MODE_LABEL = {
  PRODUCTS: "Choose products",
  COLLECTIONS: "Choose collections",
  SKUS: "Upload or paste SKUs",
};

export const ROUNDING = {
  NONE: "NONE",
  END_99: "END_99",
  END_95: "END_95",
  WHOLE: "WHOLE",
};

export const ITEM_STATUS = {
  PENDING: "PENDING",
  UPDATED: "UPDATED",
  FAILED: "FAILED",
  RESTORED: "RESTORED",
  // A later campaign took this variant over. The campaign that owns this row no
  // longer restores it -- whoever holds it now carries the original price.
  SUPERSEDED: "SUPERSEDED",
};

export const LOG_LEVEL = {
  INFO: "INFO",
  SUCCESS: "SUCCESS",
  WARNING: "WARNING",
  ERROR: "ERROR",
};

// Statuses where campaign prices are live on the storefront, and so can be
// rolled back to the stored originals.
export const ROLLBACKABLE_STATUSES = [
  CAMPAIGN_STATUS.ACTIVE,
  CAMPAIGN_STATUS.COMPLETED,
  CAMPAIGN_STATUS.FAILED,
];
