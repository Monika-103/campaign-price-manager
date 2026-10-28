import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopCurrency } from "../models/shopify.products.server";
import { listAppDiscounts } from "../models/bundle-discount.server";
import {
  DISCOUNT_BADGE,
  DISCOUNT_METHOD,
  describeOffer,
  describeSelection,
  discountStatus,
} from "../models/bundle-discount";
import { describeSchedule, formatMoney } from "../components/format";

// Shopify's own statuses, plus one for a discount removed in the Shopify
// admin after the app created it.
const LIVE_BADGE = {
  ACTIVE: { label: "Active", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  EXPIRED: { label: "Ended", tone: "neutral" },
  DELETED: { label: "Deleted in Shopify", tone: "critical" },
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [discounts, currencyCode] = await Promise.all([
    listAppDiscounts(admin, session.shop),
    getShopCurrency(admin),
  ]);

  return { discounts, currencyCode };
};

export default function Discounts() {
  const { discounts, currencyCode } = useLoaderData();

  return (
    <s-page heading="Discounts" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/discounts/new"
      >
        Create discount
      </s-button>

      {discounts.length === 0 ? (
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <s-heading>No discounts yet</s-heading>
            <s-paragraph>
              Offer a set of items for one price, like any 3 for{" "}
              {formatMoney(55, currencyCode)}. The saving is taken off at
              checkout, so your product prices stay as they are.
            </s-paragraph>
            <s-button variant="primary" href="/app/discounts/new">
              Create discount
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Discount</s-table-header>
              <s-table-header listSlot="secondary">Offer</s-table-header>
              <s-table-header>How customers get it</s-table-header>
              <s-table-header>Applies to</s-table-header>
              <s-table-header>Runs</s-table-header>
              <s-table-header format="numeric">Used</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {discounts.map((discount) => {
                // Shopify's live status where it answered; otherwise worked
                // out from the dates.
                const badge = discount.liveStatus
                  ? LIVE_BADGE[discount.liveStatus]
                  : DISCOUNT_BADGE[discountStatus(discount)];

                return (
                  <s-table-row
                    key={discount.id}
                    clickDelegate={`discount-${discount.id}`}
                  >
                    <s-table-cell>
                      <s-link
                        id={`discount-${discount.id}`}
                        href={`/app/discounts/${discount.id}`}
                      >
                        {discount.title}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {describeOffer(discount, currencyCode)}
                    </s-table-cell>
                    <s-table-cell>
                      {discount.method === DISCOUNT_METHOD.CODE ? (
                        <s-text type="strong">{discount.code}</s-text>
                      ) : (
                        <s-text color="subdued">Automatic</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>{describeSelection(discount)}</s-table-cell>
                    <s-table-cell>
                      {describeSchedule({
                        startAt: discount.startsAt,
                        endAt: discount.endedAt ?? discount.endsAt,
                      })}
                    </s-table-cell>
                    <s-table-cell>
                      <s-text fontVariantNumeric="tabular-nums">
                        {discount.usage ?? "—"}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
