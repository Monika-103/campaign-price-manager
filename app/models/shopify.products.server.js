// All Admin API access for the price engine lives here, so the pricing rules
// and the routes stay free of GraphQL.

// productVariantsBulkUpdate accepts at most 250 variants per call, and is
// scoped to one product, so updates are grouped per product and then chunked.
const MAX_VARIANTS_PER_CALL = 250;

// Variants read per product. Products with more are reported back, so a
// campaign is never quietly partial.
const VARIANTS_PER_PRODUCT = 100;

// Products read per page when walking a collection.
const PRODUCTS_PER_PAGE = 100;

// Safety stop when paging through a very large collection, so one runaway
// selection cannot spend the whole API budget.
const MAX_COLLECTION_PAGES = 50;

// SKUs per search query. Shopify's search string has a practical length limit,
// so lookups are batched rather than sent as one enormous OR chain.
const SKUS_PER_QUERY = 40;

// The app-reserved namespace and key holding a variant's pre-campaign prices.
// Writing this to Shopify means the original price survives the loss of our own
// database: the variant itself carries what it should be restored to.
export const ORIGINAL_PRICE_NAMESPACE = "$app";
export const ORIGINAL_PRICE_KEY = "campaign_original_price";

// Metafields accepted per metafieldsSet call.
const METAFIELDS_PER_CALL = 25;

// Shared variant selection. `originalPrice` is the snapshot metafield: when it
// is present the variant is already under a campaign.
const VARIANT_FIELDS = `
  id
  title
  sku
  price
  compareAtPrice
  originalPrice: metafield(namespace: "${ORIGINAL_PRICE_NAMESPACE}", key: "${ORIGINAL_PRICE_KEY}") {
    value
  }`;

const PRODUCTS_QUERY = `#graphql
  query campaignProducts($ids: [ID!]!, $variantCount: Int!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        variants(first: $variantCount) {
          pageInfo {
            hasNextPage
          }
          nodes {
            ${VARIANT_FIELDS}
          }
        }
      }
    }
  }`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query campaignCollectionProducts($id: ID!, $cursor: String, $productCount: Int!, $variantCount: Int!) {
    collection(id: $id) {
      id
      title
      products(first: $productCount, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          variants(first: $variantCount) {
            pageInfo {
              hasNextPage
            }
            nodes {
              ${VARIANT_FIELDS}
            }
          }
        }
      }
    }
  }`;

const VARIANTS_BY_SKU_QUERY = `#graphql
  query campaignVariantsBySku($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      nodes {
        ${VARIANT_FIELDS}
        product {
          id
          title
        }
      }
    }
  }`;

const BULK_UPDATE_MUTATION = `#graphql
  mutation campaignVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation campaignSaveOriginalPrices($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const METAFIELDS_DELETE_MUTATION = `#graphql
  mutation campaignClearOriginalPrices($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        key
      }
      userErrors {
        field
        message
      }
    }
  }`;

const SHOP_QUERY = `#graphql
  query campaignShop {
    shop {
      currencyCode
    }
  }`;

export async function getShopCurrency(admin) {
  const response = await admin.graphql(SHOP_QUERY);
  const body = await response.json();
  return body.data?.shop?.currencyCode ?? "USD";
}

/**
 * Decode the snapshot metafield on a variant.
 *
 * Returns null when the variant is not under a campaign. A value we cannot
 * parse is also treated as absent rather than thrown: a corrupt snapshot should
 * not make the variant impossible to work with.
 */
function readOriginalPrice(variant) {
  const raw = variant.originalPrice?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.price === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Record each variant's pre-campaign prices on the variant itself.
 *
 * This is written *before* the prices change, so the value on the variant is
 * always what it should be restored to. It also marks the variant as claimed:
 * another campaign can see it is already discounted without consulting our
 * database, which is what makes the snapshot survive a database loss.
 */
export async function saveOriginalPrices(admin, items, campaignId) {
  const metafields = items.map((item) => ({
    ownerId: item.variantId,
    namespace: ORIGINAL_PRICE_NAMESPACE,
    key: ORIGINAL_PRICE_KEY,
    type: "json",
    value: JSON.stringify({
      price: item.price,
      compareAtPrice: item.compareAtPrice ?? null,
      campaignId,
      savedAt: new Date().toISOString(),
    }),
  }));

  const failed = [];

  for (const batch of chunk(metafields, METAFIELDS_PER_CALL)) {
    try {
      const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
        variables: { metafields: batch },
      });
      const body = await response.json();
      const userErrors = body.data?.metafieldsSet?.userErrors ?? [];

      if (userErrors.length > 0) {
        failed.push(userErrors.map((error) => error.message).join("; "));
      }
    } catch (error) {
      failed.push(error.message ?? "Failed to save original prices");
    }
  }

  return { failed };
}

/**
 * Remove the snapshot once prices have been restored, releasing the variants
 * so a later campaign can claim them.
 */
export async function clearOriginalPrices(admin, variantIds) {
  const metafields = variantIds.map((variantId) => ({
    ownerId: variantId,
    namespace: ORIGINAL_PRICE_NAMESPACE,
    key: ORIGINAL_PRICE_KEY,
  }));

  for (const batch of chunk(metafields, METAFIELDS_PER_CALL)) {
    try {
      await admin.graphql(METAFIELDS_DELETE_MUTATION, {
        variables: { metafields: batch },
      });
    } catch {
      // A snapshot left behind is recoverable -- the next campaign reports the
      // variant as claimed and the merchant can restore it again -- so a failed
      // cleanup must not fail the rollback that already succeeded.
    }
  }
}

/**
 * Flatten the selected products into a single list of variants, which is the
 * unit both the pricing rules and the update mutation work in.
 *
 * `truncatedProducts` names any product with more variants than one page, so
 * the caller can warn rather than skip them without saying so.
 */
export async function fetchVariants(admin, productIds) {
  if (productIds.length === 0) return { variants: [], truncatedProducts: [] };

  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { ids: productIds, variantCount: VARIANTS_PER_PRODUCT },
  });
  const body = await response.json();

  const variants = [];
  const truncatedProducts = [];

  for (const product of body.data?.nodes ?? []) {
    // `nodes` returns null for ids the shop can no longer resolve, such as a
    // product deleted between selection and preview.
    if (!product?.id) continue;

    if (product.variants.pageInfo.hasNextPage) {
      truncatedProducts.push(product.title);
    }

    for (const variant of product.variants.nodes) {
      variants.push({
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        originalPrice: readOriginalPrice(variant),
      });
    }
  }

  return { variants, truncatedProducts };
}

// Flattens one product node from any query into our variant shape.
function variantsOfProduct(product, truncatedProducts) {
  if (product.variants.pageInfo.hasNextPage) {
    truncatedProducts.push(product.title);
  }

  return product.variants.nodes.map((variant) => ({
    productId: product.id,
    productTitle: product.title,
    variantId: variant.id,
    variantTitle: variant.title,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    originalPrice: readOriginalPrice(variant),
  }));
}

/**
 * Every variant of every product in the given collections.
 *
 * Collections are paged through to the end rather than read one page deep, so
 * a 500-product collection is not quietly reduced to its first 100. Manual and
 * automated collections both work -- the API exposes their contents the same
 * way. A product in two selected collections is only included once.
 */
export async function fetchVariantsForCollections(admin, collectionIds) {
  if (collectionIds.length === 0) {
    return { variants: [], truncatedProducts: [], missingCollections: [] };
  }

  const variants = [];
  const truncatedProducts = [];
  const missingCollections = [];
  const seenVariantIds = new Set();

  for (const collectionId of collectionIds) {
    let cursor = null;
    let page = 0;
    let resolved = false;

    do {
      const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
        variables: {
          id: collectionId,
          cursor,
          productCount: PRODUCTS_PER_PAGE,
          variantCount: VARIANTS_PER_PRODUCT,
        },
      });
      const body = await response.json();
      const collection = body.data?.collection;

      if (!collection) break;
      resolved = true;

      for (const product of collection.products.nodes) {
        for (const variant of variantsOfProduct(product, truncatedProducts)) {
          // The same product can sit in more than one selected collection.
          if (seenVariantIds.has(variant.variantId)) continue;
          seenVariantIds.add(variant.variantId);
          variants.push(variant);
        }
      }

      cursor = collection.products.pageInfo.hasNextPage
        ? collection.products.pageInfo.endCursor
        : null;
      page += 1;
    } while (cursor && page < MAX_COLLECTION_PAGES);

    if (!resolved) missingCollections.push(collectionId);
  }

  return { variants, truncatedProducts, missingCollections };
}

/**
 * Resolve a list of SKUs to the variants that carry them.
 *
 * Unlike the product and collection modes, this selects individual variants,
 * not whole products -- a sheet of SKUs is usually a deliberate subset.
 *
 * Shopify's search can match on more than an exact value, so results are
 * filtered back down to exact, case-insensitive SKU equality. `unmatched` lists
 * every SKU that found nothing, so the merchant sees their typos instead of a
 * campaign that silently covers fewer products than they intended.
 */
export async function fetchVariantsBySkus(admin, rows) {
  if (rows.length === 0) return { variants: [], unmatched: [], duplicates: [] };

  // Preserve the sheet's order but drop repeats, comparing case-insensitively.
  // The row is kept alongside the SKU so any prices it carries can be attached
  // to the matching variant below.
  const wanted = new Map();
  const duplicates = [];
  for (const row of rows) {
    const sku = String(row.sku ?? "").trim();
    const key = sku.toLowerCase();
    if (!key) continue;
    if (wanted.has(key)) {
      duplicates.push(sku);
      continue;
    }
    wanted.set(key, { ...row, sku });
  }

  const variants = [];
  const matchedKeys = new Set();
  const batches = chunk(
    [...wanted.values()].map((row) => row.sku),
    SKUS_PER_QUERY,
  );

  for (const batch of batches) {
    // Quote each SKU so values containing spaces or dashes stay one term.
    const query = batch
      .map((sku) => `sku:'${sku.replace(/'/g, "\\'")}'`)
      .join(" OR ");

    const response = await admin.graphql(VARIANTS_BY_SKU_QUERY, {
      variables: { query, first: MAX_VARIANTS_PER_CALL },
    });
    const body = await response.json();

    for (const variant of body.data?.productVariants?.nodes ?? []) {
      const key = (variant.sku ?? "").trim().toLowerCase();
      if (!wanted.has(key)) continue;

      matchedKeys.add(key);
      const row = wanted.get(key);

      variants.push({
        productId: variant.product.id,
        productTitle: variant.product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        originalPrice: readOriginalPrice(variant),
        // Targets from the sheet, used by the FROM_SHEET and SHEET_PERCENTAGE
        // rules. Null when the sheet carried no such column.
        sheetPrice: row.price ?? null,
        sheetCompareAt: row.compareAt ?? null,
        sheetDiscount: row.discount ?? null,
      });
    }
  }

  const unmatched = [...wanted.entries()]
    .filter(([key]) => !matchedKeys.has(key))
    .map(([, row]) => row.sku);

  return { variants, unmatched, duplicates };
}

/**
 * Single entry point for all three selection modes. Returns the variants plus
 * any warnings worth showing the merchant before they apply.
 *
 * @param {{mode: string, productIds?: string[], collectionIds?: string[], skus?: string[]}} selection
 */
export async function resolveSelection(admin, selection) {
  const warnings = [];

  const note = (list, singular) =>
    `${list.length} ${singular}${list.length === 1 ? "" : "s"}`;

  if (selection.mode === "COLLECTIONS") {
    const { variants, truncatedProducts, missingCollections } =
      await fetchVariantsForCollections(admin, selection.collectionIds ?? []);

    if (missingCollections.length > 0) {
      warnings.push(
        `${missingCollections.length} collection(s) could not be read and were skipped.`,
      );
    }
    addTruncationWarning(warnings, truncatedProducts);

    return {
      variants,
      warnings,
      note: note(selection.collectionIds ?? [], "collection"),
    };
  }

  if (selection.mode === "SKUS") {
    const { variants, unmatched, duplicates } = await fetchVariantsBySkus(
      admin,
      selection.rows ?? [],
    );

    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, 10).join(", ");
      warnings.push(
        `${unmatched.length} SKU(s) matched no variant and were skipped: ${shown}${
          unmatched.length > 10 ? ", …" : ""
        }`,
      );
    }
    if (duplicates.length > 0) {
      warnings.push(
        `${duplicates.length} duplicate SKU(s) in the sheet were counted once.`,
      );
    }

    return { variants, warnings, note: note(selection.rows ?? [], "SKU") };
  }

  const { variants, truncatedProducts } = await fetchVariants(
    admin,
    selection.productIds ?? [],
  );
  addTruncationWarning(warnings, truncatedProducts);

  return {
    variants,
    warnings,
    note: note(selection.productIds ?? [], "product"),
  };
}

function addTruncationWarning(warnings, truncatedProducts) {
  if (truncatedProducts.length === 0) return;

  const shown = truncatedProducts.slice(0, 5).join(", ");
  warnings.push(
    `Only the first ${VARIANTS_PER_PRODUCT} variants were read for: ${shown}${
      truncatedProducts.length > 5 ? ", …" : ""
    }`,
  );
}

function groupByProduct(updates) {
  const byProduct = new Map();

  for (const update of updates) {
    const existing = byProduct.get(update.productId);
    if (existing) {
      existing.push(update);
    } else {
      byProduct.set(update.productId, [update]);
    }
  }

  return byProduct;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Write prices back to Shopify, one call per product.
 *
 * Failures are recorded per variant instead of thrown, so one bad product
 * cannot abandon a campaign halfway with no record of what already changed.
 *
 * @returns {Promise<{succeeded: string[], failed: Array<{variantId: string, message: string}>}>}
 */
export async function applyVariantPrices(admin, updates) {
  const succeeded = [];
  const failed = [];

  for (const [productId, productUpdates] of groupByProduct(updates)) {
    for (const batch of chunk(productUpdates, MAX_VARIANTS_PER_CALL)) {
      const variants = batch.map((update) => ({
        id: update.variantId,
        price: update.price,
        // Explicit null clears compare-at. Omitting the key would leave the
        // current value in place, which a rollback must not do.
        compareAtPrice: update.compareAtPrice ?? null,
      }));

      try {
        const response = await admin.graphql(BULK_UPDATE_MUTATION, {
          variables: { productId, variants },
        });
        const body = await response.json();
        const result = body.data?.productVariantsBulkUpdate;
        const userErrors = result?.userErrors ?? [];

        if (userErrors.length > 0) {
          const message = userErrors.map((error) => error.message).join("; ");
          for (const update of batch) {
            failed.push({ variantId: update.variantId, message });
          }
          continue;
        }

        const updated = new Set(
          (result?.productVariants ?? []).map((variant) => variant.id),
        );
        for (const update of batch) {
          if (updated.has(update.variantId)) {
            succeeded.push(update.variantId);
          } else {
            failed.push({
              variantId: update.variantId,
              message: "Variant was not returned by Shopify",
            });
          }
        }
      } catch (error) {
        for (const update of batch) {
          failed.push({
            variantId: update.variantId,
            message: error.message ?? "Request to Shopify failed",
          });
        }
      }
    }
  }

  return { succeeded, failed };
}
