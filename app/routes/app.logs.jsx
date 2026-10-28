import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { readActor } from "../models/actor.server";
import { listActors, listChangeLog } from "../models/campaign.server";
import { CAMPAIGN_KIND } from "../models/campaign.constants";
import { describeActor, formatDateTime } from "../components/format";

// Up to two initials for the avatar, so it reads as a person rather than a
// block of colour. Falls back to a single dash when we have no name at all.
function initialsOf(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "–";

  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

const LOG_TONE = {
  SUCCESS: "success",
  WARNING: "caution",
  ERROR: "critical",
  INFO: "neutral",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { actorName, actorEmail: currentEmail } = readActor(session);
  const actorEmail = new URL(request.url).searchParams.get("actor") ?? "";

  const [entries, actors] = await Promise.all([
    listChangeLog(session.shop, { actorEmail: actorEmail || undefined }),
    listActors(session.shop),
  ]);

  return {
    entries,
    actors,
    actorEmail,
    // Shown so it is obvious whose account the app is currently acting as.
    currentUser: {
      name: actorName ?? "",
      email: currentEmail,
      shop: session.shop,
      isOnline: session.isOnline,
    },
  };
};

export default function Logs() {
  const { entries, actors, actorEmail, currentUser } = useLoaderData();
  const [, setSearchParams] = useSearchParams();

  const filterByActor = (event) => {
    const value = event.target.value;
    setSearchParams(value ? { actor: value } : {});
  };

  return (
    <s-page heading="Change log" inlineSize="large">
      <s-section slot="aside" heading="Signed in as">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-avatar initials={initialsOf(currentUser.name)} size="base" />
            <s-stack direction="block" gap="small-500">
              <s-text>{currentUser.name || "Name not available"}</s-text>
              <s-text color="subdued">
                {currentUser.email || "Email not available"}
              </s-text>
              <s-text color="subdued">{currentUser.shop}</s-text>
            </s-stack>
          </s-stack>

          {!currentUser.email && (
            <s-banner
              tone="warning"
              heading="Your details are not available yet"
            >
              <s-paragraph>
                Names and emails come from the signed-in staff account. Close
                the app and open it again so Shopify issues a fresh session.
              </s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading={`Change log (${entries.length})`}>
        <s-stack direction="block" gap="base">
          {actors.length > 0 && (
            <s-select
              label="Filter by person"
              value={actorEmail}
              onChange={filterByActor}
            >
              <s-option value="">Everyone</s-option>
              {actors.map((actor) => (
                <s-option key={actor.actorEmail} value={actor.actorEmail}>
                  {describeActor(actor)}
                </s-option>
              ))}
            </s-select>
          )}

          {entries.length === 0 ? (
            <s-paragraph>
              Nothing recorded yet. Run a campaign or a price update and it will
              appear here.
            </s-paragraph>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="kicker">When</s-table-header>
                <s-table-header listSlot="primary">What changed</s-table-header>
                <s-table-header listSlot="secondary">Who</s-table-header>
                <s-table-header>Run</s-table-header>
                <s-table-header listSlot="inline">Level</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {entries.map((entry) => (
                  <s-table-row key={entry.id}>
                    <s-table-cell>
                      {formatDateTime(entry.createdAt)}
                    </s-table-cell>
                    <s-table-cell>{entry.message}</s-table-cell>
                    {/* Name and email share one cell: two short lines read
                        better than two half-empty columns. */}
                    <s-table-cell>
                      {entry.actorEmail ? (
                        <s-stack direction="block" gap="small-500">
                          <s-text>{entry.actorName || entry.actorEmail}</s-text>
                          {entry.actorName && (
                            <s-text color="subdued">{entry.actorEmail}</s-text>
                          )}
                        </s-stack>
                      ) : (
                        <s-text color="subdued">The app</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {/* Price updates were removed from the app; their old
                          runs stay in the log but have no page to open. */}
                      {entry.campaign.kind === CAMPAIGN_KIND.PRICE_UPDATE ? (
                        <s-text>{entry.campaign.name}</s-text>
                      ) : (
                        <s-link href={`/app/campaigns/${entry.campaign.id}`}>
                          {entry.campaign.name}
                        </s-link>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={LOG_TONE[entry.level] ?? "neutral"}>
                        {entry.level.toLowerCase()}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="About the log">
        <s-paragraph>
          Each change is attributed to the staff account signed in at the time.
          Entries are kept after a restore or undo, so the history stays
          complete. Runs from before this was added show no person.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
