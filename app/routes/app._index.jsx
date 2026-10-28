import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDashboardData } from "../models/campaign.server";
import { CAMPAIGN_KIND } from "../models/campaign.constants";
import {
  DISCOUNT_BADGE,
  describeOffer,
  describeSelection,
  discountStatus,
} from "../models/bundle-discount";
import { getShopCurrency } from "../models/shopify.products.server";
import {
  describeRule,
  describeSchedule,
  formatDateTime,
  formatMoney,
  statusBadge,
} from "../components/format";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [dashboard, currencyCode] = await Promise.all([
    getDashboardData(session.shop),
    getShopCurrency(admin),
  ]);

  return { ...dashboard, currencyCode };
};

const LOG_TONE = {
  SUCCESS: "success",
  WARNING: "caution",
  ERROR: "critical",
  INFO: "neutral",
};

// Link to a run. Runs from the removed price-update feature have no page any
// more, so they get no link.
function hrefFor(run) {
  return run.kind === CAMPAIGN_KIND.PRICE_UPDATE
    ? null
    : `/app/campaigns/${run.id}`;
}

export default function Dashboard() {
  const {
    stats,
    recentCampaigns,
    recentDiscounts,
    needsAttention,
    activity,
    currencyCode,
  } = useLoaderData();

  const tiles = [
    {
      icon: "megaphone",
      label: "Active campaigns",
      value: stats.active,
      tone: stats.active > 0 ? "success" : "neutral",
    },
    {
      icon: "discount",
      label: "Products discounted",
      value: stats.discountedNow,
      tone: "neutral",
    },
    {
      icon: "price-list",
      label: "Active discounts",
      value: stats.activeDiscounts,
      tone: stats.activeDiscounts > 0 ? "success" : "neutral",
    },
    {
      icon: "chart-line",
      label: "Variants changed",
      value: stats.productsUpdated,
      tone: "neutral",
    },
  ];

  const nothingYet =
    recentCampaigns.length === 0 && recentDiscounts.length === 0;

  return (
    <s-page heading="Campaign Manager" inlineSize="large">
      <s-button
        slot="primary-action"
        href="/app/campaigns/new"
        variant="primary"
      >
        Create campaign
      </s-button>
      <s-button slot="secondary-actions" href="/app/discounts/new">
        Create discount
      </s-button>

      {needsAttention.length > 0 && (
        <s-banner tone="critical" heading="Some variants failed to update">
          <s-unordered-list>
            {needsAttention.map((entry) => (
              <s-list-item key={entry.id}>
                <s-link href={hrefFor(entry) ?? "/app/logs"}>
                  {entry.name}
                </s-link>{" "}
                — {entry.failedCount} failed
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section>
        <s-grid
          gap="base"
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
        >
          {tiles.map((tile) => (
            <s-box
              key={tile.label}
              padding="large-100"
              borderWidth="base"
              borderRadius="large"
              background="base"
            >
              <s-stack direction="block" gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type={tile.icon} tone={tile.tone} size="base" />
                  <s-text color="subdued">{tile.label}</s-text>
                </s-stack>
                <s-heading fontVariantNumeric="tabular-nums">
                  {tile.value}
                </s-heading>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      {nothingYet && (
        <s-section heading="Start here">
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))"
          >
            <s-box padding="large-100" borderWidth="base" borderRadius="large">
              <s-stack direction="block" gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="megaphone" size="base" />
                  <s-text>Campaign</s-text>
                </s-stack>
                <s-paragraph>
                  A temporary offer. Original prices are stored and put back
                  when you restore it.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button href="/app/campaigns/new" variant="primary">
                    Create campaign
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>

            <s-box padding="large-100" borderWidth="base" borderRadius="large">
              <s-stack direction="block" gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="price-list" size="base" />
                  <s-text>Discount</s-text>
                </s-stack>
                <s-paragraph>
                  A set of items for one price, like any 3 for{" "}
                  {formatMoney(55, currencyCode)}. Taken off at checkout;
                  product prices stay as they are.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button href="/app/discounts/new">
                    Create discount
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      )}

      {recentCampaigns.length > 0 && (
        <s-section heading="Campaigns">
          <s-link slot="secondary-actions" href="/app/campaigns">
            View all
          </s-link>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Campaign</s-table-header>
              <s-table-header listSlot="secondary">Price rule</s-table-header>
              <s-table-header format="numeric">Variants</s-table-header>
              <s-table-header>Runs</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentCampaigns.map((campaign) => {
                const badge = statusBadge(campaign.status);

                return (
                  <s-table-row
                    key={campaign.id}
                    clickDelegate={`campaign-${campaign.id}`}
                  >
                    <s-table-cell>
                      <s-link
                        id={`campaign-${campaign.id}`}
                        href={`/app/campaigns/${campaign.id}`}
                      >
                        {campaign.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{describeRule(campaign)}</s-table-cell>
                    <s-table-cell>
                      <s-text fontVariantNumeric="tabular-nums">
                        {campaign.updatedCount}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>{describeSchedule(campaign)}</s-table-cell>
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

      {recentDiscounts.length > 0 && (
        <s-section heading="Discounts">
          <s-link slot="secondary-actions" href="/app/discounts">
            View all
          </s-link>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Discount</s-table-header>
              <s-table-header listSlot="secondary">Offer</s-table-header>
              <s-table-header>Applies to</s-table-header>
              <s-table-header>Runs</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentDiscounts.map((discount) => {
                const badge = DISCOUNT_BADGE[discountStatus(discount)];

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
                    <s-table-cell>{describeSelection(discount)}</s-table-cell>
                    <s-table-cell>
                      {describeSchedule({
                        startAt: discount.startsAt,
                        endAt: discount.endedAt ?? discount.endsAt,
                      })}
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

      {activity.length > 0 && (
        <s-section slot="aside" heading="Recent activity">
          <s-link slot="secondary-actions" href="/app/logs">
            Full log
          </s-link>
          <s-stack direction="block" gap="large-100">
            {activity.map((log) => (
              <s-stack key={log.id} direction="block" gap="small-300">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone={LOG_TONE[log.level] ?? "neutral"}>
                    {log.level.toLowerCase()}
                  </s-badge>
                  <s-text color="subdued">
                    {formatDateTime(log.createdAt)}
                  </s-text>
                </s-stack>
                <s-text lineClamp={2}>{log.message}</s-text>
                {hrefFor(log.campaign) ? (
                  <s-link href={hrefFor(log.campaign)}>
                    {log.campaign.name}
                  </s-link>
                ) : (
                  <s-text color="subdued">{log.campaign.name}</s-text>
                )}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
