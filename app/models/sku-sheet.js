// Parsing for the SKU sheet. Kept free of Shopify and React so the rules can be
// exercised on their own.

// Column headers are matched on exact (normalised) equality rather than by
// substring, so "selling price" cannot be mistaken for the "price" column.
const SKU_HEADERS = [
  "sku",
  "skus",
  "stockcode",
  "stock code",
  "variant sku",
  "sku code",
  "code",
  "item code",
];

// The "was" price, shown struck through on the storefront.
const COMPARE_AT_HEADERS = [
  "rrp",
  "msrp",
  "compare at price",
  "compare-at price",
  "compare at",
  "compare-at",
  "was",
  "was price",
  "list price",
  "full price",
];

// The price the customer actually pays.
const PRICE_HEADERS = [
  "price",
  "selling price",
  "sale price",
  "new price",
  "now",
  "now price",
  "unit price",
];

// A per-row discount, so each SKU can be cut by its own amount.
const DISCOUNT_HEADERS = [
  "discount",
  "discount %",
  "discount%",
  "discount percent",
  "discount percentage",
  "percent",
  "percentage",
  "%",
  "off",
  "% off",
];

function normalise(cell) {
  return cell.trim().replace(/^"|"$/g, "").toLowerCase();
}

function splitRow(row) {
  // Tab, comma and semicolon all show up depending on how the sheet was
  // exported, and Excel uses semicolons in several locales.
  return row.split(/[\t,;]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

/**
 * Read a money value out of a sheet cell.
 *
 * Handles currency symbols, thousands separators and the comma decimal used in
 * much of Europe. Returns null for anything that is not a number, so a stray
 * "N/A" or an empty cell leaves that field alone rather than becoming 0.00.
 */
export function parseMoney(value) {
  if (value === null || value === undefined) return null;

  let text = String(value).trim();
  if (!text) return null;

  // Strip everything that cannot be part of a number.
  text = text.replace(/[^\d.,-]/g, "");
  if (!text) return null;

  const hasDot = text.includes(".");
  const hasComma = text.includes(",");

  if (hasDot && hasComma) {
    // Whichever appears last is the decimal separator: "1.234,56" vs "1,234.56"
    const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    text = text.split(thousands).join("");
    if (decimal === ",") text = text.replace(",", ".");
  } else if (hasComma) {
    // A lone comma with exactly two trailing digits is a decimal ("150,99");
    // otherwise it is a thousands separator ("1,500").
    text = /,\d{2}$/.test(text)
      ? text.replace(",", ".")
      : text.split(",").join("");
  }

  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parsed.toFixed(2);
}

/**
 * Read a discount percentage from a sheet cell.
 *
 * Accepts "20", "20%" and "0.2" -- a value at or below 1 is read as a fraction,
 * since a sheet written that way means a fifth off, not a fifth of a percent.
 * Anything outside 0-100 is rejected rather than clamped, so a typo becomes a
 * skipped row the merchant can see instead of a silent 100% discount.
 */
export function parsePercent(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim().replace(/%/g, "");
  if (!text) return null;

  const parsed = Number.parseFloat(text.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  const percent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  if (percent > 100) return null;

  return percent;
}

function findColumn(cells, headers) {
  return cells.findIndex((cell) => headers.includes(normalise(cell)));
}

/**
 * Pull SKUs -- and, when the sheet carries them, prices -- out of pasted text
 * or an uploaded CSV.
 *
 * A header row is what unlocks the price columns: without one, the sheet is
 * read as a plain list of SKUs. This is deliberate. Guessing that the second
 * column of an unlabelled sheet means "RRP" would be a very expensive thing to
 * get wrong.
 *
 * @returns {{rows: Array<{sku: string, price: string|null, compareAt: string|null}>,
 *            skus: string[], skippedRows: number, usedHeader: string|null,
 *            hasPrices: boolean, columns: {sku: string|null, price: string|null, compareAt: string|null}}}
 */
export function parseSkuSheet(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);

  const empty = {
    rows: [],
    skus: [],
    skippedRows: 0,
    usedHeader: null,
    hasPrices: false,
    hasDiscounts: false,
    columns: { sku: null, price: null, compareAt: null, discount: null },
  };

  if (lines.length === 0) return empty;

  const firstCells = splitRow(lines[0]);
  const skuIndex = findColumn(firstCells, SKU_HEADERS);
  const hasHeader = skuIndex !== -1;

  const priceIndex = hasHeader ? findColumn(firstCells, PRICE_HEADERS) : -1;
  const compareAtIndex = hasHeader
    ? findColumn(firstCells, COMPARE_AT_HEADERS)
    : -1;
  const discountIndex = hasHeader
    ? findColumn(firstCells, DISCOUNT_HEADERS)
    : -1;

  const columnIndex = hasHeader ? skuIndex : 0;
  const startRow = hasHeader ? 1 : 0;

  const rows = [];
  let skippedRows = 0;

  for (const line of lines.slice(startRow)) {
    const cells = splitRow(line);

    // When a header named the SKU column, trust it: a blank cell there means
    // the row has no SKU. Falling back to another column would quietly read a
    // price as a SKU. Only an unlabelled sheet scans for the first value.
    const sku = hasHeader
      ? cells[columnIndex]
      : cells[columnIndex] || cells.find((cell) => cell.length > 0);

    if (!sku) {
      skippedRows += 1;
      continue;
    }

    rows.push({
      sku,
      price: priceIndex === -1 ? null : parseMoney(cells[priceIndex]),
      compareAt:
        compareAtIndex === -1 ? null : parseMoney(cells[compareAtIndex]),
      discount:
        discountIndex === -1 ? null : parsePercent(cells[discountIndex]),
    });
  }

  return {
    rows,
    skus: rows.map((row) => row.sku),
    skippedRows,
    usedHeader: hasHeader ? firstCells[skuIndex] : null,
    // Only true when a price column was found *and* some row actually carries a
    // usable number, so an all-blank price column does not offer a rule that
    // would clear every price.
    hasPrices:
      (priceIndex !== -1 || compareAtIndex !== -1) &&
      rows.some((row) => row.price !== null || row.compareAt !== null),
    hasDiscounts:
      discountIndex !== -1 && rows.some((row) => row.discount !== null),
    columns: {
      sku: hasHeader ? firstCells[skuIndex] : null,
      price: priceIndex === -1 ? null : firstCells[priceIndex],
      compareAt: compareAtIndex === -1 ? null : firstCells[compareAtIndex],
      discount: discountIndex === -1 ? null : firstCells[discountIndex],
    },
  };
}
