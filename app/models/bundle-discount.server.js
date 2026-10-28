// "Buy N for a fixed price" discounts, e.g. any 3 for 55.
//
// Unlike a campaign, nothing here changes a product's price. The app creates a
// discount in Shopify that runs the bundle-price-discount function at
// checkout, and Shopify starts and ends it on the dates given. It is either
// automatic (applies by itself in the cart) or a code the customer enters.
// This module creates, ends and deletes those discounts and keeps the app's
// own record.

import prisma from "../db.server";
import { readActor } from "./actor.server";
import {
  DISCOUNT_KIND,
  DISCOUNT_METHOD,
  DISCOUNT_SELECTION,
  usesCode,
} from "./bundle-discount";
import { formatMoney } from "../components/format";

// Must match `handle` in extensions/bundle-price-discount/shopify.extension.toml.
const FUNCTION_HANDLE = "bundle-price-discount";

const USER_ERRORS = `userErrors {
        field
        message
      }`;

// Automatic and code discounts are separate objects in Shopify, each with its
// own create, end and delete mutations. The rest of this module only picks
// the right set.
const MUTATIONS = {
  [DISCOUNT_METHOD.AUTOMATIC]: {
    create: {
      query: `#graphql
  mutation CreateAutomaticBundleDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
      }
      ${USER_ERRORS}
    }
  }`,
      field: "discountAutomaticAppCreate",
      created: "automaticAppDiscount",
    },
    end: {
      query: `#graphql
  mutation EndAutomaticBundleDiscount($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      ${USER_ERRORS}
    }
  }`,
      field: "discountAutomaticDeactivate",
    },
    remove: {
      query: `#graphql
  mutation DeleteAutomaticBundleDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      ${USER_ERRORS}
    }
  }`,
      field: "discountAutomaticDelete",
    },
  },
  [DISCOUNT_METHOD.CODE]: {
    create: {
      query: `#graphql
  mutation CreateCodeBundleDiscount($discount: DiscountCodeAppInput!) {
    discountCodeAppCreate(codeAppDiscount: $discount) {
      codeAppDiscount {
        discountId
      }
      ${USER_ERRORS}
    }
  }`,
      field: "discountCodeAppCreate",
      created: "codeAppDiscount",
    },
    end: {
      query: `#graphql
  mutation EndCodeBundleDiscount($id: ID!) {
    discountCodeDeactivate(id: $id) {
      ${USER_ERRORS}
    }
  }`,
      field: "discountCodeDeactivate",
    },
    remove: {
      query: `#graphql
  mutation DeleteCodeBundleDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      ${USER_ERRORS}
    }
  }`,
      field: "discountCodeDelete",
    },
  },
};

// A link discount is a code discount in Shopify; only how it is shared
// differs.
function mutationsFor(method) {
  return usesCode(method)
    ? MUTATIONS[DISCOUNT_METHOD.CODE]
    : MUTATIONS[DISCOUNT_METHOD.AUTOMATIC];
}

const STORE_URL_QUERY = `#graphql
  query StoreUrl {
    shop {
      primaryDomain {
        url
      }
    }
  }`;

// The storefront address discount links are built on: the store's own
// domain where it has one, so the link looks like the store.
export async function getStoreUrl(admin) {
  const response = await admin.graphql(STORE_URL_QUERY);
  const body = await response.json();
  return body.data?.shop?.primaryDomain?.url ?? null;
}

async function run(admin, { query, field }, variables) {
  const response = await admin.graphql(query, { variables });
  const body = await response.json();
  const result = body.data?.[field];
  return { result, userErrors: result?.userErrors ?? [] };
}

function messageOf(userErrors) {
  return userErrors.map((error) => error.message).join(" ");
}

export async function listBundleDiscounts(shop) {
  return prisma.bundleDiscount.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

// Live state of the app's discounts, looked up by ID in one request.
const LIVE_STATE_QUERY = `#graphql
  query AppDiscountsLiveState($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on DiscountAutomaticNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticApp {
            status
            asyncUsageCount
          }
        }
      }
      ... on DiscountCodeNode {
        id
        codeDiscount {
          ... on DiscountCodeApp {
            status
            asyncUsageCount
          }
        }
      }
    }
  }`;

/**
 * Only the discounts this app created, newest first, each with its live
 * status and usage from Shopify.
 *
 * The list comes from the app's own records, so discounts made in the Shopify
 * admin or by other apps never appear. Shopify is still asked for the status,
 * because a discount can be ended or deleted there without the app knowing.
 * If that lookup fails the list still shows, with status worked out from the
 * dates instead.
 */
export async function listAppDiscounts(admin, shop) {
  const records = await listBundleDiscounts(shop);
  const ids = records
    .map((record) => record.shopifyDiscountId)
    .filter(Boolean);

  let live = null;
  if (ids.length > 0) {
    try {
      const response = await admin.graphql(LIVE_STATE_QUERY, {
        variables: { ids },
      });
      const body = await response.json();
      live = new Map(
        (body.data?.nodes ?? [])
          .filter(Boolean)
          .map((node) => {
            const discount = node.automaticDiscount ?? node.codeDiscount ?? {};
            return [
              node.id,
              { status: discount.status, usage: discount.asyncUsageCount },
            ];
          }),
      );
    } catch (error) {
      console.error("[discounts] could not read live state", error);
    }
  }

  return records.map((record) => {
    const state = live?.get(record.shopifyDiscountId);
    return {
      ...record,
      // null: Shopify was not asked or did not answer. "DELETED": Shopify
      // answered and the discount is no longer there.
      liveStatus: live ? (state?.status ?? "DELETED") : null,
      usage: state?.usage ?? null,
    };
  });
}

export async function getBundleDiscount(shop, id) {
  return prisma.bundleDiscount.findFirst({ where: { id, shop } });
}

/**
 * Create the discount in Shopify, then record it here.
 *
 * Shopify is written first: if it refuses (a code already in use, say),
 * nothing is recorded, so the app never lists a discount that does not exist
 * at checkout.
 */
export async function createBundleDiscount(admin, shop, input) {
  const actor = readActor(input.session);
  const isCode = usesCode(input.method);
  const isLink = input.method === DISCOUNT_METHOD.LINK;
  const isGift = input.kind === DISCOUNT_KIND.GIFT;
  const bundlePrice = isGift ? null : input.bundlePrice.toFixed(2);
  const giftPrice = isGift ? input.giftPrice.toFixed(2) : null;
  const bySpend = isGift && input.giftThreshold === "SPEND";
  const minSpend = bySpend ? input.minSpend.toFixed(2) : null;
  const ids = input.selection.map((entry) => entry.id);
  const isCollections = input.selectionMode === DISCOUNT_SELECTION.COLLECTIONS;

  // What the function reads at checkout. `collectionIds` is always present,
  // even empty, because the function's input query takes it as a variable.
  const selectionConfig = {
    productIds: isCollections ? [] : ids,
    collectionIds: isCollections ? ids : [],
  };
  const configuration = isGift
    ? {
        type: DISCOUNT_KIND.GIFT,
        threshold: bySpend ? "SPEND" : "ITEMS",
        quantity: input.quantity,
        minSpend,
        giftPrice,
        giftProductIds: [input.giftProduct.id],
        giftsPerSet: 1,
        repeat: input.giftRepeats,
        ...selectionConfig,
        // Shown to the customer in the cart next to the saving. For a code
        // discount Shopify shows the code instead.
        message: `${bySpend ? `Spend ${formatMoney(minSpend, input.currencyCode)}` : `Buy ${input.quantity}`}, get ${input.giftProduct.title} for ${formatMoney(giftPrice, input.currencyCode)}`,
      }
    : {
        type: DISCOUNT_KIND.BUNDLE,
        quantity: input.quantity,
        bundlePrice,
        ...selectionConfig,
        message: `${input.quantity} for ${formatMoney(bundlePrice, input.currencyCode)}`,
      };

  const discount = {
    title: input.title,
    functionHandle: FUNCTION_HANDLE,
    discountClasses: ["PRODUCT"],
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt ? input.endsAt.toISOString() : null,
    // A bundle stacks with order and shipping discounts, but not with another
    // product discount on the same items -- two cuts to one bundle would
    // undercut the bundle price the merchant chose. A gift stacks with
    // everything: it is an extra on top of whatever else the customer gets.
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: isGift,
      shippingDiscounts: true,
    },
    metafields: [
      {
        namespace: "$app",
        key: "function-configuration",
        type: "json",
        value: JSON.stringify(configuration),
      },
    ],
    ...(isCode
      ? {
          code: input.code,
          usageLimit: input.usageLimit,
          appliesOncePerCustomer: input.oncePerCustomer,
        }
      : {}),
  };

  const create = mutationsFor(input.method).create;
  const { result, userErrors } = await run(admin, create, { discount });
  const created = result?.[create.created];

  if (userErrors.length > 0 || !created) {
    return {
      error:
        messageOf(userErrors) ||
        "Shopify did not create the discount. Try again.",
    };
  }

  // If the record cannot be saved, take the Shopify discount back down rather
  // than leave a live offer at checkout that the app knows nothing about and
  // cannot end.
  try {
    const record = await prisma.bundleDiscount.create({
      data: {
        shop,
        shopifyDiscountId: created.discountId,
        title: input.title,
        kind: isGift ? DISCOUNT_KIND.GIFT : DISCOUNT_KIND.BUNDLE,
        giftProduct: isGift ? JSON.stringify(input.giftProduct) : null,
        giftPrice,
        giftRepeats: isGift ? input.giftRepeats : false,
        giftThreshold: bySpend ? "SPEND" : "ITEMS",
        minSpend,
        method: input.method,
        code: isCode ? input.code : null,
        landingPath: isLink ? input.landingPath : null,
        usageLimit: isCode ? input.usageLimit : null,
        oncePerCustomer: isCode ? input.oncePerCustomer : false,
        quantity: input.quantity,
        bundlePrice,
        selectionMode: input.selectionMode,
        selection: JSON.stringify(input.selection),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...actor,
      },
    });

    return { discount: record };
  } catch (error) {
    await run(admin, mutationsFor(input.method).remove, {
      id: created.discountId,
    }).catch(() => {});
    console.error("[discounts] could not save record, discount removed", error);
    return {
      error:
        "The discount could not be saved in the app, so it was removed from Shopify again. Nothing is live. Try again, and if it keeps happening restart the app.",
    };
  }
}

/**
 * Stop the discount now. It stays in Shopify's discount list as expired, so
 * past orders still show which offer they used.
 */
export async function endBundleDiscount(admin, shop, id) {
  const discount = await getBundleDiscount(shop, id);
  if (!discount) return { error: "Not found." };

  const { userErrors } = await run(admin, mutationsFor(discount.method).end, {
    id: discount.shopifyDiscountId,
  });
  if (userErrors.length > 0) return { error: messageOf(userErrors) };

  const ended = await prisma.bundleDiscount.update({
    where: { id: discount.id },
    data: { endedAt: new Date() },
  });

  return { discount: ended };
}

/**
 * Remove the discount from Shopify and from the app. A discount already
 * deleted in the Shopify admin is treated as gone, so the app's record can
 * still be cleared.
 */
export async function deleteBundleDiscount(admin, shop, id) {
  const discount = await getBundleDiscount(shop, id);
  if (!discount) return { error: "Not found." };

  if (discount.shopifyDiscountId) {
    const { userErrors } = await run(
      admin,
      mutationsFor(discount.method).remove,
      { id: discount.shopifyDiscountId },
    );
    const alreadyGone = userErrors.some((error) =>
      /not exist|not found/i.test(error.message),
    );
    if (userErrors.length > 0 && !alreadyGone) {
      return { error: messageOf(userErrors) };
    }
  }

  await prisma.bundleDiscount.delete({ where: { id: discount.id } });
  return { deleted: discount.title };
}
