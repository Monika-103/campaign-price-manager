/* eslint-disable react/prop-types */
// This project has no prop-types dependency and is plain JavaScript, so the
// recommended React rule cannot be satisfied without adding one. The props are
// documented on the component instead.

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  APPLY_TO,
  CAMPAIGN_KIND,
  PRICE_ACTION,
  PRICE_ACTION_LABEL,
  ROUNDING,
  SELECTION_MODE,
} from "../models/campaign.constants";
import { parseSkuSheet } from "../models/sku-sheet";
import { calculateNewPrices } from "../models/pricing";
import { formatDateTime, formatMoney } from "./format";
import { END_TIMES, TIMES, timeLabel, toMoment } from "./schedule";

// Each method is explained in plain words with a worked example, so a merchant
// can pick one without knowing what "compare-at" means beforehand. `money`
// formats in the shop's currency.
function priceActions(money) {
  return [
    {
      value: PRICE_ACTION.MANUAL,
      label: PRICE_ACTION_LABEL.MANUAL,
      details: `Every selected product gets the same price that you type in. For example, set them all to ${money(20)}.`,
    },
    {
      value: PRICE_ACTION.PERCENTAGE,
      label: PRICE_ACTION_LABEL.PERCENTAGE,
      details: `Take a percentage off the price. For example, 20% off ${money(50)} makes it ${money(40)}.`,
    },
    {
      value: PRICE_ACTION.SELLING_TO_COMPARE,
      label: PRICE_ACTION_LABEL.SELLING_TO_COMPARE,
      details: `Show a sale with the old price crossed out. The current price becomes the "was" price and the discount is taken off it. For example, ${money(50)} becomes "was ${money(50)}, now ${money(40)}".`,
    },
    {
      value: PRICE_ACTION.COMPARE_TO_SELLING,
      label: PRICE_ACTION_LABEL.COMPARE_TO_SELLING,
      details: `For products that already show a "was" price. The new price is a percentage off that. For example, was ${money(60)} with 20% off makes it ${money(48)}.`,
    },
  ];
}

// A made-up product the live example is worked on. It has both prices, so
// every method has something to calculate from.
const EXAMPLE_VARIANT = { price: "50.00", compareAtPrice: "60.00" };

/**
 * The product selection, price rule and preview shared by both price screens.
 *
 * @param {object} props
 * @param {"CAMPAIGN"|"PRICE_UPDATE"} props.kind  Campaigns get a schedule and
 *   can take products over from another campaign. Price updates get neither:
 *   they change the normal price and always leave discounted products alone.
 * @param {string} props.currencyCode  Used for display only.
 */
export default function PriceEditor({ kind, currencyCode }) {
  const isCampaign = kind === CAMPAIGN_KIND.CAMPAIGN;
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const fileInput = useRef(null);

  const [selectionMode, setSelectionMode] = useState(SELECTION_MODE.PRODUCTS);
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [skuText, setSkuText] = useState("");
  // Sticky once chosen, so the apply that follows a take-over preview carries
  // the same decision the merchant saw.
  const [takeOver, setTakeOver] = useState(false);
  const [rule, setRule] = useState({
    priceAction: PRICE_ACTION.PERCENTAGE,
    applyTo: APPLY_TO.PRICE,
    value: "20",
    rounding: ROUNDING.END_99,
  });
  const [details, setDetails] = useState({
    name: "",
    description: "",
    startAt: "",
    startTime: "00:00",
    endAt: "",
    endTime: "23:59",
  });

  const startMoment = toMoment(details.startAt, details.startTime);
  const endMoment = toMoment(details.endAt, details.endTime);
  // Decides the wording of the apply button; the server makes the same check
  // when it decides whether to apply now or schedule.
  const startsLater = Boolean(startMoment) && new Date(startMoment) > new Date();

  const preview = fetcher.data?.preview;
  const error = fetcher.data?.error;
  const busy = fetcher.state !== "idle";

  const sheet = parseSkuSheet(skuText);
  const sheetPricesAvailable =
    selectionMode === SELECTION_MODE.SKUS && sheet.hasPrices;
  const sheetDiscountsAvailable =
    selectionMode === SELECTION_MODE.SKUS && sheet.hasDiscounts;

  const usingSheetPrices = rule.priceAction === PRICE_ACTION.FROM_SHEET;
  const usingSheetDiscounts =
    rule.priceAction === PRICE_ACTION.SHEET_PERCENTAGE;

  // The sheet carries figures, but the chosen rule will not read them.
  // A sheet carrying figures is an instruction, not just a product list: the
  // other rules would throw those figures away, so they are locked off. A sheet
  // of bare SKUs leaves every rule available.
  const sheetDictatesPrices = sheetPricesAvailable || sheetDiscountsAvailable;

  const sheetColumns = [
    sheet.columns.compareAt && `an RRP column ("${sheet.columns.compareAt}")`,
    sheet.columns.price && `a price column ("${sheet.columns.price}")`,
    sheet.columns.discount && `a discount column ("${sheet.columns.discount}")`,
  ]
    .filter(Boolean)
    .join(" and ");

  // Keep the selection on a rule that is actually selectable, so the form never
  // sits on a disabled choice after a sheet with figures is pasted.
  useEffect(() => {
    if (!sheetDictatesPrices) return;
    if (usingSheetPrices || usingSheetDiscounts) return;

    setRule((current) => ({
      ...current,
      priceAction: sheet.hasPrices
        ? PRICE_ACTION.FROM_SHEET
        : PRICE_ACTION.SHEET_PERCENTAGE,
    }));
  }, [
    sheetDictatesPrices,
    sheet.hasPrices,
    usingSheetPrices,
    usingSheetDiscounts,
  ]);
  const usesApplyTo =
    rule.priceAction === PRICE_ACTION.MANUAL ||
    rule.priceAction === PRICE_ACTION.PERCENTAGE;
  const isManual = rule.priceAction === PRICE_ACTION.MANUAL;
  const money = (amount) => formatMoney(amount, currencyCode);

  // The chosen rule worked through on a sample product, using the same
  // calculation the preview and the real run use, so it cannot drift from what
  // actually happens. Sheet rules have no single figure to show.
  const example = (() => {
    if (usingSheetPrices || usingSheetDiscounts) return null;
    if (rule.value === "" || rule.value === null || rule.value === undefined) {
      return null;
    }

    const result = calculateNewPrices(rule, EXAMPLE_VARIANT);
    if (result.reason) return null;

    const before = `A product selling at ${money(EXAMPLE_VARIANT.price)}, with a "was" price of ${money(EXAMPLE_VARIANT.compareAtPrice)},`;
    if (result.skipped) return `${before} would not change.`;

    return `${before} would sell at ${money(result.price)}, with a "was" price of ${money(result.compareAtPrice)}.`;
  })();

  const selectionIsEmpty =
    (selectionMode === SELECTION_MODE.PRODUCTS && products.length === 0) ||
    (selectionMode === SELECTION_MODE.COLLECTIONS &&
      collections.length === 0) ||
    (selectionMode === SELECTION_MODE.SKUS && sheet.rows.length === 0);

  // One picker for both resource types; they differ only in what they return.
  const pickResources = async (type, current, setCurrent) => {
    const picked = await shopify.resourcePicker({
      type,
      multiple: true,
      selectionIds: current.map((entry) => ({ id: entry.id })),
    });

    // The picker resolves to nothing when dismissed; keep the current
    // selection rather than clearing it.
    if (!picked) return;

    setCurrent(picked.map(({ id, title }) => ({ id, title })));
  };

  // The sheet is read in the browser and dropped into the textarea, so the
  // merchant can see and correct exactly what was picked up before applying.
  const readSheet = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setSkuText(String(reader.result ?? ""));
    reader.readAsText(file);

    // Reset so choosing the same file twice still fires a change event.
    event.target.value = "";
  };

  const submit = (intent, options = {}) =>
    fetcher.submit(
      {
        intent,
        ...rule,
        name: details.name,
        description: details.description,
        // Sent as exact moments rather than a date and a time, so the server
        // never has to guess which timezone they were meant in.
        startAt: startMoment,
        endAt: endMoment,
        selectionMode,
        productIds: JSON.stringify(products.map((product) => product.id)),
        collectionIds: JSON.stringify(
          collections.map((collection) => collection.id),
        ),
        skuText,
        takeOver: String(options.takeOver ?? takeOver),
      },
      { method: "POST" },
    );

  const updateRule = (key) => (event) =>
    setRule((current) => ({ ...current, [key]: event.target.value }));
  const updateDetails = (key) => (event) =>
    setDetails((current) => ({ ...current, [key]: event.target.value }));

  // ChoiceList reports its selection as an array on `currentTarget.values`,
  // not as `target.value` like the other fields.
  const updateChoice = (key) => (event) => {
    const [selected] = event.currentTarget.values ?? [];
    if (!selected) return;
    setRule((current) => ({ ...current, [key]: selected }));
  };

  return (
    <>
      {error && (
        <s-banner tone="critical" heading="Nothing was changed">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={isCampaign ? "Campaign details" : "Details"}>
        <s-stack direction="block" gap="base">
          <s-text-field
            label={isCampaign ? "Campaign name" : "Name"}
            value={details.name}
            onChange={updateDetails("name")}
            placeholder={
              isCampaign ? "September Sale 20%" : "Supplier increase, September"
            }
          />
          {isCampaign && (
            <s-grid
              gap="base"
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            >
              <s-date-field
                label="Start date"
                value={details.startAt}
                onChange={updateDetails("startAt")}
                details="A time already passed starts the offer as soon as you apply"
              />
              <s-select
                label="Start time"
                value={details.startTime}
                onChange={updateDetails("startTime")}
              >
                {TIMES.map((time) => (
                  <s-option key={time} value={time}>
                    {timeLabel(time)}
                  </s-option>
                ))}
              </s-select>
              <s-date-field
                label="End date (optional)"
                value={details.endAt}
                onChange={updateDetails("endAt")}
                details="Leave empty to run until you restore prices"
              />
              <s-select
                label="End time"
                value={details.endTime}
                onChange={updateDetails("endTime")}
                disabled={!details.endAt}
              >
                {END_TIMES.map((time) => (
                  <s-option key={time} value={time}>
                    {timeLabel(time)}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          )}
          {isCampaign && startMoment && (
            <s-paragraph color="subdued">
              {startsLater
                ? `Prices change automatically on ${formatDateTime(startMoment)}`
                : "Prices change as soon as you apply"}
              {endMoment
                ? ` and go back on ${formatDateTime(endMoment)}.`
                : " and stay until you restore them."}{" "}
              Times are in your timezone.
            </s-paragraph>
          )}
          <s-text-area
            label="Description (optional)"
            value={details.description}
            onChange={updateDetails("description")}
          />
        </s-stack>
      </s-section>

      <s-section heading="Products">
        <s-stack direction="block" gap="base">
          <s-select
            label="Select products by"
            value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value)}
          >
            <s-option value={SELECTION_MODE.PRODUCTS}>Products</s-option>
            <s-option value={SELECTION_MODE.COLLECTIONS}>Collections</s-option>
            <s-option value={SELECTION_MODE.SKUS}>SKU sheet</s-option>
          </s-select>

          {selectionMode === SELECTION_MODE.PRODUCTS && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {products.length === 0
                  ? "No products selected yet."
                  : `${products.length} product${
                      products.length === 1 ? "" : "s"
                    } selected. Every variant of each product is included.`}
              </s-paragraph>
              {products.length > 0 && (
                <s-unordered-list>
                  {products.slice(0, 10).map((product) => (
                    <s-list-item key={product.id}>{product.title}</s-list-item>
                  ))}
                  {products.length > 10 && (
                    <s-list-item>and {products.length - 10} more</s-list-item>
                  )}
                </s-unordered-list>
              )}
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() =>
                    pickResources("product", products, setProducts)
                  }
                >
                  {products.length === 0
                    ? "Select products"
                    : "Change selection"}
                </s-button>
                {products.length > 0 && (
                  <s-button variant="tertiary" onClick={() => setProducts([])}>
                    Clear
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          )}

          {selectionMode === SELECTION_MODE.COLLECTIONS && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {collections.length === 0
                  ? "No collections selected yet."
                  : `${collections.length} collection${
                      collections.length === 1 ? "" : "s"
                    } selected. Every product in them is included, and the list is read fresh each time you preview.`}
              </s-paragraph>
              {collections.length > 0 && (
                <s-unordered-list>
                  {collections.map((collection) => (
                    <s-list-item key={collection.id}>
                      {collection.title}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              )}
              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() =>
                    pickResources("collection", collections, setCollections)
                  }
                >
                  {collections.length === 0
                    ? "Select collections"
                    : "Change selection"}
                </s-button>
                {collections.length > 0 && (
                  <s-button
                    variant="tertiary"
                    onClick={() => setCollections([])}
                  >
                    Clear
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          )}

          {selectionMode === SELECTION_MODE.SKUS && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Upload a CSV or paste SKUs below, one per line. A sheet with a
                SKU column works too, and price or discount columns unlock the
                rules that use them. Only the variants carrying these SKUs are
                updated, not whole products.
              </s-paragraph>

              {/* Hidden native input: the file is read in the browser and its
                  contents land in the textarea for review. */}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={readSheet}
                style={{ display: "none" }}
              />

              <s-stack direction="inline" gap="base">
                <s-button onClick={() => fileInput.current?.click()}>
                  Upload CSV
                </s-button>
                {skuText && (
                  <s-button variant="tertiary" onClick={() => setSkuText("")}>
                    Clear
                  </s-button>
                )}
              </s-stack>

              <s-text-area
                label="SKUs"
                value={skuText}
                onChange={(event) => setSkuText(event.target.value)}
                placeholder={"WW-CR-001\nWW-OM-002\nWW-MG-003"}
                rows={6}
              />

              <s-paragraph>
                {sheet.rows.length === 0
                  ? "No SKUs read yet."
                  : `${sheet.rows.length} SKU${
                      sheet.rows.length === 1 ? "" : "s"
                    } read. Any that match no variant are reported in the preview.`}
              </s-paragraph>

              {(sheet.hasPrices || sheet.hasDiscounts) && (
                <s-banner tone="info" heading="Columns found in this sheet">
                  <s-paragraph>
                    {[
                      sheet.columns.sku && `SKU from "${sheet.columns.sku}"`,
                      sheet.columns.compareAt &&
                        `compare-at from "${sheet.columns.compareAt}"`,
                      sheet.columns.price &&
                        `price from "${sheet.columns.price}"`,
                      sheet.columns.discount &&
                        `discount % from "${sheet.columns.discount}"`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Pick the matching rule below to use them.
                  </s-paragraph>
                </s-banner>
              )}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Price rule">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Choose how the new prices are worked out. Nothing is saved until
            you have seen every change in the preview.
          </s-paragraph>
          {/* Descriptions go in the `details` slot. s-choice has no
              `details` attribute, so passing one as a prop showed nothing. */}
          <s-choice-list
            label="How should prices change?"
            values={[rule.priceAction]}
            onChange={updateChoice("priceAction")}
          >
            {sheetPricesAvailable && (
              <s-choice value={PRICE_ACTION.FROM_SHEET}>
                {PRICE_ACTION_LABEL.FROM_SHEET}
                <s-text slot="details">
                  Each SKU gets the price and RRP written on its own row of
                  your sheet.
                </s-text>
              </s-choice>
            )}
            {sheetDiscountsAvailable && (
              <s-choice value={PRICE_ACTION.SHEET_PERCENTAGE}>
                {PRICE_ACTION_LABEL.SHEET_PERCENTAGE}
                <s-text slot="details">
                  Each SKU is discounted by the percentage on its own row of
                  your sheet.
                </s-text>
              </s-choice>
            )}
            {priceActions(money).map((action) => (
              <s-choice
                key={action.value}
                value={action.value}
                {...(sheetDictatesPrices ? { disabled: true } : {})}
              >
                {action.label}
                <s-text slot="details">
                  {sheetDictatesPrices
                    ? "Not available while your sheet supplies the prices."
                    : action.details}
                </s-text>
              </s-choice>
            ))}
          </s-choice-list>

          {sheetDictatesPrices && (
            <s-banner tone="info" heading="Your sheet is setting the prices">
              <s-paragraph>
                It has {sheetColumns}, so those figures are used and the other
                rules are turned off — they would work from the prices in
                Shopify and throw your sheet&apos;s away. Remove those columns
                from the sheet if you want a rule applied to every row instead.
              </s-paragraph>
            </s-banner>
          )}

          {usingSheetPrices || usingSheetDiscounts ? (
            <s-paragraph>
              {usingSheetPrices
                ? "Each SKU gets the prices on its own row. A blank cell leaves that field as it is, so a sheet that only fills in one column will not clear the other."
                : "Each SKU is cut by the percentage on its own row, taken off that row's RRP where there is one. Rows with no discount are skipped."}
            </s-paragraph>
          ) : (
            <s-grid
              gap="base"
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            >
              {usesApplyTo && (
                // For a manual price this picks which price is replaced; for
                // a percentage it picks what the discount is taken off. Same
                // setting, so the wording follows the method.
                <s-select
                  label={isManual ? "Price to set" : "Take the discount off"}
                  value={rule.applyTo}
                  onChange={updateRule("applyTo")}
                  details={
                    rule.applyTo === APPLY_TO.COMPARE_AT
                      ? 'The compare-at price is the crossed-out "was" price. Products without one are skipped.'
                      : "The selling price is what customers pay today."
                  }
                >
                  <s-option value={APPLY_TO.PRICE}>Selling price</s-option>
                  <s-option value={APPLY_TO.COMPARE_AT}>
                    Compare-at price (&quot;was&quot; price)
                  </s-option>
                </s-select>
              )}

              <s-number-field
                label={
                  isManual ? `New price (${currencyCode})` : "Discount percentage"
                }
                value={rule.value}
                onChange={updateRule("value")}
                min={0}
                {...(isManual ? {} : { max: 100 })}
                suffix={isManual ? "" : "%"}
                details={
                  isManual
                    ? "Every selected product gets exactly this price."
                    : `How much to take off. 20 means 20% off.`
                }
              />

              <s-select
                label="Round the new price"
                value={rule.rounding}
                onChange={updateRule("rounding")}
                details={`Examples start from a worked-out price of ${money(39.2)}. It is rounded to the nearest whole amount first, then given the ending.`}
              >
                <s-option value={ROUNDING.NONE}>
                  Keep exact (e.g. {money(39.2)})
                </s-option>
                <s-option value={ROUNDING.END_99}>
                  End in .99 (e.g. {money(38.99)})
                </s-option>
                <s-option value={ROUNDING.END_95}>
                  End in .95 (e.g. {money(38.95)})
                </s-option>
                <s-option value={ROUNDING.WHOLE}>
                  Whole number (e.g. {money(39)})
                </s-option>
              </s-select>
            </s-grid>
          )}

          {example && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Example</s-text>
                <s-text>{example}</s-text>
              </s-stack>
            </s-box>
          )}

          <s-stack direction="inline">
            <s-button
              onClick={() => submit("preview")}
              {...(busy ? { loading: true } : {})}
              {...(selectionIsEmpty ? { disabled: true } : {})}
            >
              Preview changes
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {preview && (
        <s-section heading="Preview changes">
          <s-stack direction="block" gap="base">
            {preview.warnings.map((warning) => (
              <s-banner key={warning} tone="warning">
                <s-paragraph>{warning}</s-paragraph>
              </s-banner>
            ))}

            {preview.conflicts?.length > 0 && (
              <s-banner
                tone="warning"
                heading={`${preview.conflicts.length} variant${
                  preview.conflicts.length === 1 ? " is" : "s are"
                } in an active campaign`}
              >
                <s-paragraph>
                  {isCampaign
                    ? "These are left untouched. Either restore the campaign holding them first, or take them over — their new prices are then worked out from the original price, not the current discounted one."
                    : "These are left untouched. Their current price belongs to a campaign, which would restore the old price when it ends and throw this change away. Restore that campaign first, then run this update."}
                </s-paragraph>
                <s-unordered-list>
                  {preview.conflicts.slice(0, 10).map((conflict) => (
                    <s-list-item key={conflict.sku ?? conflict.productTitle}>
                      {conflict.sku ? <b>{conflict.sku}</b> : null}
                      {conflict.sku ? " — " : ""}
                      {conflict.productTitle}
                      {conflict.campaignName
                        ? ` (in "${conflict.campaignName}")`
                        : ""}
                    </s-list-item>
                  ))}
                  {preview.conflicts.length > 10 && (
                    <s-list-item>
                      and {preview.conflicts.length - 10} more
                    </s-list-item>
                  )}
                </s-unordered-list>
                {isCampaign && (
                  <s-stack direction="inline">
                    <s-button
                      onClick={() => {
                        setTakeOver(true);
                        submit("preview", { takeOver: true });
                      }}
                      {...(busy ? { loading: true } : {})}
                    >
                      Take over these {preview.conflicts.length}
                    </s-button>
                  </s-stack>
                )}
              </s-banner>
            )}

            {preview.takenOverCount > 0 && (
              <s-banner
                tone="info"
                heading={`Taking over ${preview.takenOverCount} variant${
                  preview.takenOverCount === 1 ? "" : "s"
                }`}
              >
                <s-paragraph>
                  Their prices are calculated from the original price, so
                  discounts do not compound. This campaign becomes the one that
                  restores them.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button
                    variant="tertiary"
                    onClick={() => {
                      setTakeOver(false);
                      submit("preview", { takeOver: false });
                    }}
                  >
                    Leave them alone instead
                  </s-button>
                </s-stack>
              </s-banner>
            )}

            {preview.largeDrops?.length > 0 && (
              <s-banner
                tone="critical"
                heading={`${preview.largeDrops.length} price${
                  preview.largeDrops.length === 1 ? "" : "s"
                } drop by more than half`}
              >
                <s-paragraph>
                  Check these are intended before applying. A shifted column or
                  a misplaced decimal looks exactly like this.
                </s-paragraph>
                <s-unordered-list>
                  {preview.largeDrops.slice(0, 5).map((drop) => (
                    <s-list-item key={drop.sku ?? drop.productTitle}>
                      {drop.productTitle}
                      {drop.sku ? ` (${drop.sku})` : ""}:{" "}
                      {formatMoney(drop.price, currencyCode)} →{" "}
                      {formatMoney(drop.newPrice, currencyCode)} (−
                      {drop.percent}%)
                    </s-list-item>
                  ))}
                  {preview.largeDrops.length > 5 && (
                    <s-list-item>
                      and {preview.largeDrops.length - 5} more
                    </s-list-item>
                  )}
                </s-unordered-list>
              </s-banner>
            )}

            <s-paragraph>
              {preview.changes.length} variant
              {preview.changes.length === 1 ? "" : "s"} across{" "}
              {preview.productCount} product
              {preview.productCount === 1 ? "" : "s"} will change
              {preview.skipped.length > 0
                ? `. ${preview.skipped.length} will be skipped.`
                : "."}
            </s-paragraph>

            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="currency">Current price</s-table-header>
                <s-table-header format="currency">
                  Current compare-at
                </s-table-header>
                <s-table-header format="currency">New price</s-table-header>
                <s-table-header format="currency">
                  New compare-at
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {preview.changes.slice(0, 50).map((change) => (
                  <s-table-row key={change.variantId}>
                    <s-table-cell>
                      {change.productTitle}
                      {change.variantTitle &&
                      change.variantTitle !== "Default Title"
                        ? ` - ${change.variantTitle}`
                        : ""}
                    </s-table-cell>
                    <s-table-cell>
                      {formatMoney(
                        change.livePrice ?? change.price,
                        currencyCode,
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {formatMoney(
                        change.liveCompareAtPrice ?? change.compareAtPrice,
                        currencyCode,
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {formatMoney(change.newPrice, currencyCode)}
                    </s-table-cell>
                    <s-table-cell>
                      {formatMoney(change.newCompareAtPrice, currencyCode)}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {preview.changes.length > 50 && (
              <s-paragraph>
                Showing the first 50 of {preview.changes.length} variants.
              </s-paragraph>
            )}

            {isCampaign && startsLater ? (
              <s-banner tone="info" heading="Nothing changes until the start time">
                <s-paragraph>
                  {`The campaign is saved as scheduled. On ${formatDateTime(startMoment)} the prices are worked out again from the live prices and applied, with every original price stored first.`}
                </s-paragraph>
              </s-banner>
            ) : (
              <s-banner tone="warning" heading="This updates live product prices">
                <s-paragraph>
                  {isCampaign
                    ? "The original price of every variant is stored first, so you can restore them at any time from the campaign page."
                    : "This changes the normal price for good. The previous prices are recorded, so the update can be undone from its own page if it was a mistake."}
                </s-paragraph>
              </s-banner>
            )}

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => submit("apply")}
                {...(busy ? { loading: true } : {})}
              >
                {!isCampaign
                  ? "Update prices"
                  : startsLater
                    ? "Schedule campaign"
                    : "Apply price updates"}
              </s-button>
              <s-button
                variant="tertiary"
                href="/app/campaigns"
              >
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </>
  );
}
