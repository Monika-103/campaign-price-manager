import { useEffect } from "react";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopCurrency } from "../models/shopify.products.server";
import {
  deleteBundleDiscount,
  endBundleDiscount,
  getBundleDiscount,
  getStoreUrl,
} from "../models/bundle-discount.server";
import {
  DISCOUNT_BADGE,
  DISCOUNT_METHOD,
  DISCOUNT_SELECTION,
  DISCOUNT_STATUS,
  DISCOUNT_KIND,
  DISCOUNT_KIND_LABEL,
  describeMethod,
  describeOffer,
  discountLink,
  readGiftProduct,
  usesCode,
  discountStatus,
  readSelection,
  shopifyAdminUrl,
} from "../models/bundle-discount";
import { describeActor, formatDateTime, formatMoney } from "../components/format";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);

  const [discount, currencyCode, storeUrl] = await Promise.all([
    getBundleDiscount(session.shop, params.id),
    getShopCurrency(admin),
    getStoreUrl(admin),
  ]);

  if (!discount) {
    throw new Response("Discount not found", { status: 404 });
  }

  return { discount, currencyCode, storeUrl };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const intent = String((await request.formData()).get("intent"));

  if (intent === "end") {
    const result = await endBundleDiscount(admin, session.shop, params.id);
    return result.error ? { error: result.error } : { ended: true };
  }

  if (intent === "delete") {
    const result = await deleteBundleDiscount(admin, session.shop, params.id);
    if (result.error) return { error: result.error };
    return redirect("/app/discounts");
  }

  return { error: `Unknown action: ${intent}` };
};

export default function DiscountDetail() {
  const { discount, currencyCode, storeUrl } = useLoaderData();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const status = discountStatus(discount);
  const badge = DISCOUNT_BADGE[status];
  const isEnded = status === DISCOUNT_STATUS.ENDED;
  const busy = fetcher.state !== "idle";
  const selection = readSelection(discount);
  const offer = describeOffer(discount, currencyCode);
  const isGift = discount.kind === DISCOUNT_KIND.GIFT;
  const gift = readGiftProduct(discount);

  useEffect(() => {
    if (fetcher.data?.ended) shopify.toast.show("Discount ended");
  }, [fetcher.data?.ended, shopify]);

  const end = () => {
    if (window.confirm("End this discount now? Customers lose the offer straight away.")) {
      fetcher.submit({ intent: "end" }, { method: "POST" });
    }
  };

  const remove = () => {
    if (window.confirm("Delete this discount from Shopify and from the app? This cannot be undone.")) {
      fetcher.submit({ intent: "delete" }, { method: "POST" });
    }
  };

  const isCode = usesCode(discount.method);
  const isLink = discount.method === DISCOUNT_METHOD.LINK;
  const link = isLink ? discountLink(storeUrl, discount) : null;
  const bySpend = discount.giftThreshold === "SPEND";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      shopify.toast.show("Link copied");
    } catch {
      shopify.toast.show("Could not copy. Select the link and copy it instead.");
    }
  };
  const who = isLink
    ? "Customers who open the special link and buy"
    : isCode
      ? `Customers who enter ${discount.code} at checkout and buy`
      : "Customers who buy";
  const earned = bySpend
    ? `${who.replace(/ and buy$/, " and")} spend ${formatMoney(discount.minSpend, currencyCode)} on the items below`
    : `${who} any ${discount.quantity} of the items below`;
  const explanation = isGift
    ? `${earned} can add ${gift?.title ?? "the gift"} to their cart for ${formatMoney(discount.giftPrice, currencyCode)}${discount.giftRepeats ? (bySpend ? `, one for every ${formatMoney(discount.minSpend, currencyCode)} spent` : `, one for every ${discount.quantity} bought`) : ", once per order"}. Customers add the gift themselves. It stacks with your other discounts. Listed in Shopify under Discounts as "${discount.title}".`
    : `${who} any ${discount.quantity} of the items below pay ${formatMoney(discount.bundlePrice, currencyCode)} for them. Every full set of ${discount.quantity} gets the price; extra items pay full price. Listed in Shopify under Discounts as "${discount.title}".`;
  const adminUrl = shopifyAdminUrl(discount);

  const summary = [
    {
      label: "Discount type",
      value: DISCOUNT_KIND_LABEL[discount.kind] ?? DISCOUNT_KIND_LABEL.BUNDLE,
    },
    { label: "Offer", value: offer },
    ...(isGift
      ? [{ label: "Gift product", value: gift?.title ?? "—" }]
      : []),
    { label: "How customers get it", value: describeMethod(discount) },
    ...(isCode
      ? [
          {
            label: "Usage limits",
            value:
              [
                discount.usageLimit
                  ? `${discount.usageLimit} uses in total`
                  : "No total limit",
                discount.oncePerCustomer ? "one per customer" : null,
              ]
                .filter(Boolean)
                .join(", "),
          },
        ]
      : []),
    { label: "Starts", value: formatDateTime(discount.startsAt) },
    {
      label: discount.endedAt ? "Ended" : "Ends",
      value: discount.endedAt
        ? formatDateTime(discount.endedAt)
        : discount.endsAt
          ? formatDateTime(discount.endsAt)
          : "No end date",
    },
    {
      label: "Created by",
      value: discount.actorEmail ? describeActor(discount) : "—",
    },
  ];

  return (
    <s-page heading={discount.title} inlineSize="base">
      <s-button slot="secondary-actions" href="/app/discounts">
        All discounts
      </s-button>
      {adminUrl && (
        // Opens the discount in the Shopify admin, where it sits alongside the
        // store's other discounts.
        <s-button slot="secondary-actions" href={adminUrl} target="_top">
          View in Shopify discounts
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        tone="critical"
        onClick={remove}
        {...(busy ? { loading: true } : {})}
      >
        Delete
      </s-button>
      {!isEnded && (
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={end}
          {...(busy ? { loading: true } : {})}
        >
          End now
        </s-button>
      )}

      {searchParams.get("created") === "1" && (
        <s-banner tone="success" heading="Discount created">
          <s-paragraph>
            {status === DISCOUNT_STATUS.SCHEDULED
              ? `Shopify will switch it on at ${formatDateTime(discount.startsAt)}.`
              : "It is live now. Add the items to a cart in your store to see it."}
          </s-paragraph>
        </s-banner>
      )}

      {fetcher.data?.error && (
        <s-banner tone="critical">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Summary">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline">
            <s-badge tone={badge.tone}>{badge.label}</s-badge>
          </s-stack>
          <s-paragraph>
            {explanation}
          </s-paragraph>
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          >
            {summary.map((entry) => (
              <s-stack key={entry.label} direction="block" gap="small-300">
                <s-text color="subdued">{entry.label}</s-text>
                <s-text>{entry.value}</s-text>
              </s-stack>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      {isLink && (
        <s-section heading="Special link">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Share this link. Opening it switches the offer on for that
              customer and takes them to {discount.landingPath || "/"}. Nobody
              gets the offer without it.
            </s-paragraph>
            {link ? (
              <s-stack direction="block" gap="small-200">
                <s-text-field
                  label="Discount link"
                  value={link}
                  readOnly
                />
                <s-stack direction="inline">
                  <s-button onClick={copyLink}>Copy link</s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-paragraph color="subdued">
                The store address could not be read, so the link cannot be
                shown. Reload the page to try again.
              </s-paragraph>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section
        heading={
          discount.selectionMode === DISCOUNT_SELECTION.COLLECTIONS
            ? `${isGift ? "Qualifying collections" : "Collections"} (${selection.length})`
            : `${isGift ? "Qualifying products" : "Products"} (${selection.length})`
        }
      >
        <s-unordered-list>
          {selection.map((entry) => (
            <s-list-item key={entry.id}>{entry.title}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
