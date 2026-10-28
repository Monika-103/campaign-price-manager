import { useEffect } from "react";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useRouteError,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCampaign } from "../models/campaign.server";
import {
  canDelete,
  deleteCampaign,
  removeItemFromCampaign,
  rollbackCampaign,
} from "../models/campaign.apply.server";
import { getShopCurrency } from "../models/shopify.products.server";
import {
  CAMPAIGN_KIND,
  CAMPAIGN_STATUS,
  ITEM_STATUS,
  ROLLBACKABLE_STATUSES,
  SELECTION_MODE_LABEL,
} from "../models/campaign.constants";
import {
  describeRule,
  describeSchedule,
  formatDateTime,
  formatMoney,
  itemBadge,
  statusBadge,
} from "../components/format";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);

  const [campaign, currencyCode] = await Promise.all([
    getCampaign(session.shop, params.id),
    getShopCurrency(admin),
  ]);

  // Guard the kind as well as the id, so a price update cannot be opened --
  // or rolled back -- through the campaign screen.
  if (!campaign || campaign.kind !== CAMPAIGN_KIND.CAMPAIGN) {
    throw new Response("Campaign not found", { status: 404 });
  }

  return { campaign, currencyCode, mayDelete: canDelete(session) };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (String(formData.get("intent")) === "rollback") {
    const result = await rollbackCampaign(
      admin,
      session.shop,
      params.id,
      session,
    );

    if (result.error) return { error: result.error };

    return { restoredCount: result.restoredCount };
  }

  if (String(formData.get("intent")) === "removeItem") {
    const result = await removeItemFromCampaign(
      admin,
      session.shop,
      params.id,
      String(formData.get("itemId")),
      session,
    );

    if (result.error) return { error: result.error };

    return { removed: result.removed };
  }

  if (String(formData.get("intent")) === "delete") {
    const result = await deleteCampaign(session.shop, params.id, session);

    if (result.error) return { error: result.error };

    return redirect("/app/campaigns");
  }

  return { error: "Unknown action." };
};

export default function CampaignDetail() {
  const { campaign, currencyCode, mayDelete } = useLoaderData();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const justApplied = searchParams.get("applied") === "1";
  const justScheduled = searchParams.get("scheduled") === "1";
  const badge = statusBadge(campaign.status);
  const isScheduled = campaign.status === CAMPAIGN_STATUS.SCHEDULED;
  // A scheduled campaign has changed nothing yet, so its "restore" is a cancel.
  const canRollback =
    isScheduled || ROLLBACKABLE_STATUSES.includes(campaign.status);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.removed) {
      shopify.toast.show(`${fetcher.data.removed} removed`);
    }
    if (fetcher.data?.cancelled) {
      shopify.toast.show("Scheduled campaign cancelled");
    } else if (fetcher.data?.restoredCount !== undefined) {
      shopify.toast.show(
        `Restored ${fetcher.data.restoredCount} variant price(s)`,
      );
    }
  }, [
    fetcher.data?.restoredCount,
    fetcher.data?.removed,
    fetcher.data?.cancelled,
    shopify,
  ]);

  const rollback = () => {
    if (
      isScheduled &&
      !window.confirm("Cancel this campaign? It will not start.")
    ) {
      return;
    }
    fetcher.submit({ intent: "rollback" }, { method: "POST" });
  };

  // Destroys the run and its history. Only offered once no prices are live,
  // and only to the store owner.
  const remove = () => {
    const ok = window.confirm(
      "Delete this campaign and its history? This cannot be undone.",
    );
    if (ok) fetcher.submit({ intent: "delete" }, { method: "POST" });
  };

  // Puts one product back to its old price and leaves the rest running.
  const removeItem = (itemId) =>
    fetcher.submit({ intent: "removeItem", itemId }, { method: "POST" });

  const summary = [
    { label: "Price rule", value: describeRule(campaign) },
    { label: "Runs", value: describeSchedule(campaign) },
    {
      label: "Products / variants",
      value: `${campaign.productCount} / ${campaign.variantCount}`,
    },
    { label: "Applied", value: formatDateTime(campaign.appliedAt) },
    {
      label: "Selected by",
      value: [
        SELECTION_MODE_LABEL[campaign.selectionMode] ?? campaign.selectionMode,
        campaign.selectionNote ? `(${campaign.selectionNote})` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];

  return (
    <s-page heading={campaign.name} inlineSize="large">
      <s-button slot="secondary-actions" href="/app/campaigns">
        All campaigns
      </s-button>
      {mayDelete && !canRollback && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={remove}
          {...(busy ? { loading: true } : {})}
        >
          Delete
        </s-button>
      )}
      {canRollback && (
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={rollback}
          {...(busy ? { loading: true } : {})}
        >
          {isScheduled ? "Cancel campaign" : "Restore original prices"}
        </s-button>
      )}

      {isScheduled && (
        <s-banner
          tone="info"
          heading={justScheduled ? "Campaign scheduled" : "Scheduled"}
        >
          <s-paragraph>
            {`No prices have changed yet. On ${formatDateTime(campaign.startAt)} the prices are worked out from the live prices and applied`}
            {campaign.endAt
              ? `, and on ${formatDateTime(campaign.endAt)} the original prices are put back automatically.`
              : ". They stay until you restore them."}
          </s-paragraph>
        </s-banner>
      )}

      {justApplied && campaign.failedCount === 0 && (
        <s-banner tone="success" heading="Prices updated">
          <s-paragraph>
            {campaign.updatedCount} variant(s) now use the campaign price.
          </s-paragraph>
        </s-banner>
      )}

      {campaign.failedCount > 0 && (
        <s-banner tone="critical" heading="Some variants could not be updated">
          <s-paragraph>
            {campaign.failedCount} variant(s) failed. The reason is shown
            against each one in the table below.
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
          {campaign.description && (
            <s-paragraph>{campaign.description}</s-paragraph>
          )}
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
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

      <s-section heading={`Products (${campaign.items.length})`}>
        {isScheduled && campaign.items.length === 0 && (
          <s-paragraph color="subdued">
            {`About ${campaign.variantCount} variant(s) matched when this was scheduled. The exact products and prices are listed here once it starts.`}
          </s-paragraph>
        )}
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="secondary">SKU</s-table-header>
            <s-table-header format="currency">Original price</s-table-header>
            <s-table-header format="currency">Campaign price</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header />
          </s-table-header-row>
          <s-table-body>
            {campaign.items.map((item) => {
              const itemTone = itemBadge(item.status);

              return (
                <s-table-row key={item.id}>
                  <s-table-cell>
                    {item.productTitle}
                    {item.variantTitle && item.variantTitle !== "Default Title"
                      ? ` - ${item.variantTitle}`
                      : ""}
                  </s-table-cell>
                  <s-table-cell>{item.sku || "-"}</s-table-cell>
                  <s-table-cell>
                    {formatMoney(item.originalPrice, currencyCode)}
                  </s-table-cell>
                  <s-table-cell>
                    {formatMoney(item.newPrice, currencyCode)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-badge tone={itemTone.tone}>{itemTone.label}</s-badge>
                      {item.status === ITEM_STATUS.FAILED && item.error && (
                        <s-text color="subdued">{item.error}</s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {item.status === ITEM_STATUS.UPDATED && (
                      <s-button
                        variant="tertiary"
                        onClick={() => removeItem(item.id)}
                        {...(busy ? { loading: true } : {})}
                      >
                        Remove
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="Activity">
        <s-stack direction="block" gap="base">
          {campaign.logs.map((log) => (
            <s-stack key={log.id} direction="block" gap="small-300">
              <s-text color="subdued">{formatDateTime(log.createdAt)}</s-text>
              <s-text>{log.message}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
