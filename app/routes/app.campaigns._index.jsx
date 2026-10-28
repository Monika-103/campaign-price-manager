import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listCampaigns } from "../models/campaign.server";
import {
  describeRule,
  describeSchedule,
  statusBadge,
} from "../components/format";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return { campaigns: await listCampaigns(session.shop) };
};

export default function CampaignsIndex() {
  const { campaigns } = useLoaderData();

  return (
    <s-page heading="Campaigns" inlineSize="large">
      <s-button
        slot="primary-action"
        href="/app/campaigns/new"
        variant="primary"
      >
        Create campaign
      </s-button>

      <s-section>
        {campaigns.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              No campaigns yet. Create one to run a bulk price change.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button href="/app/campaigns/new" variant="primary">
                Create campaign
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Campaign</s-table-header>
              <s-table-header listSlot="secondary">Price rule</s-table-header>
              <s-table-header format="numeric">Products</s-table-header>
              <s-table-header format="numeric">Updated</s-table-header>
              <s-table-header>Runs</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((campaign) => {
                const badge = statusBadge(campaign.status);

                return (
                  <s-table-row
                    key={campaign.id}
                    clickDelegate={`row-${campaign.id}`}
                  >
                    <s-table-cell>
                      <s-link
                        id={`row-${campaign.id}`}
                        href={`/app/campaigns/${campaign.id}`}
                      >
                        {campaign.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{describeRule(campaign)}</s-table-cell>
                    <s-table-cell>{campaign.productCount}</s-table-cell>
                    <s-table-cell>{campaign.updatedCount}</s-table-cell>
                    <s-table-cell>{describeSchedule(campaign)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
