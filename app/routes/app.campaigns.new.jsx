import { redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createAndApplyCampaign,
  previewCampaign,
} from "../models/campaign.apply.server";
import { getShopCurrency } from "../models/shopify.products.server";
import {
  readRule,
  readSelection,
  validateSubmission,
} from "../models/price-form.server";
import { CAMPAIGN_KIND } from "../models/campaign.constants";
import PriceEditor from "../components/price-editor";
// The form sends exact moments (ISO timestamps), already combined from the
// chosen date and time in the merchant's own timezone.
import { parseMoment } from "../components/schedule";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const currencyCode = await getShopCurrency(admin);

  return { currencyCode };
};


export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  const rule = readRule(formData);
  const selection = readSelection(formData);

  const invalid = validateSubmission(rule, selection);
  if (invalid) return { error: invalid };

  const takeOver = String(formData.get("takeOver")) === "true";

  if (intent === "preview") {
    const preview = await previewCampaign(
      admin,
      session.shop,
      rule,
      selection,
      { takeOver },
    );

    if (preview.changes.length === 0) {
      return {
        error: preview.nothingToDo,
        preview,
      };
    }

    return { preview };
  }

  if (intent === "apply") {
    const name = String(formData.get("name") ?? "").trim();
    const startAt = parseMoment(formData.get("startAt"));
    const endAt = parseMoment(formData.get("endAt"));

    if (!name) return { error: "Enter a campaign name." };
    if (!startAt) return { error: "Enter a start date." };
    // An end date is optional: without one the campaign is open-ended and runs
    // until its prices are restored by hand.
    if (endAt && endAt <= startAt) {
      return { error: "The end time must be after the start time." };
    }
    // Would be restored by the scheduler within a minute of going live.
    if (endAt && endAt <= new Date()) {
      return { error: "The end time has already passed. Pick a later one." };
    }

    const result = await createAndApplyCampaign(admin, session.shop, {
      ...rule,
      name,
      description: String(formData.get("description") ?? ""),
      startAt,
      endAt,
      selection,
      takeOver,
      session,
    });

    if (result.error) return { error: result.error };

    return redirect(
      `/app/campaigns/${result.campaign.id}?${result.scheduled ? "scheduled" : "applied"}=1`,
    );
  }

  return { error: `Unknown action: ${intent}` };
};

export default function NewCampaign() {
  const { currencyCode } = useLoaderData();

  return (
    <s-page heading="Create campaign" inlineSize="large">
      <s-button slot="secondary-actions" href="/app/campaigns">
        Cancel
      </s-button>

      <PriceEditor kind={CAMPAIGN_KIND.CAMPAIGN} currencyCode={currencyCode} />

      <s-section slot="aside" heading="Before you apply">
        <s-paragraph>
          Prices go live as soon as you apply. Every original is stored first,
          so you can restore them from the campaign page at any time.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
