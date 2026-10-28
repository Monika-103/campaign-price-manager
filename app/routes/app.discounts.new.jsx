import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopCurrency } from "../models/shopify.products.server";
import { createBundleDiscount } from "../models/bundle-discount.server";
import {
  DISCOUNT_KIND,
  DISCOUNT_METHOD,
  DISCOUNT_SELECTION,
  generateCode,
  normaliseLandingPath,
  usesCode,
} from "../models/bundle-discount";
import { formatDateTime, formatMoney } from "../components/format";
import {
  END_TIMES,
  TIMES,
  parseMoment,
  timeLabel,
  toMoment,
} from "../components/schedule";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return { currencyCode: await getShopCurrency(admin) };
};

function readJson(formData, field, fallback) {
  try {
    return JSON.parse(String(formData.get(field) ?? "")) ?? fallback;
  } catch {
    return fallback;
  }
}

function readSelection(formData) {
  const parsed = readJson(formData, "selection", []);
  return Array.isArray(parsed)
    ? parsed.filter((entry) => typeof entry?.id === "string")
    : [];
}

function readMoney(formData, field) {
  return Number.parseFloat(String(formData.get(field) ?? ""));
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const kind =
    String(formData.get("kind")) === DISCOUNT_KIND.GIFT
      ? DISCOUNT_KIND.GIFT
      : DISCOUNT_KIND.BUNDLE;
  const isGift = kind === DISCOUNT_KIND.GIFT;
  const title = String(formData.get("title") ?? "").trim();
  const quantity = Number.parseInt(String(formData.get("quantity") ?? ""), 10);
  const bundlePrice = readMoney(formData, "bundlePrice");
  const giftPrice = readMoney(formData, "giftPrice");
  const giftProduct = readJson(formData, "giftProduct", null);
  const giftRepeats = String(formData.get("giftRepeats")) === "true";
  const giftThreshold =
    String(formData.get("giftThreshold")) === "SPEND" ? "SPEND" : "ITEMS";
  const minSpend = readMoney(formData, "minSpend");
  const selectionMode =
    String(formData.get("selectionMode")) === DISCOUNT_SELECTION.COLLECTIONS
      ? DISCOUNT_SELECTION.COLLECTIONS
      : DISCOUNT_SELECTION.PRODUCTS;
  const selection = readSelection(formData);
  const method = Object.values(DISCOUNT_METHOD).includes(
    String(formData.get("method")),
  )
    ? String(formData.get("method"))
    : DISCOUNT_METHOD.AUTOMATIC;
  const isLink = method === DISCOUNT_METHOD.LINK;
  // A link discount gets a long code nobody will guess, so the link is
  // effectively the only way in.
  const code = isLink
    ? generateCode("LINK", 12)
    : String(formData.get("code") ?? "")
        .trim()
        .toUpperCase();
  const landingPath = normaliseLandingPath(formData.get("landingPath"));
  const usageLimitRaw = String(formData.get("usageLimit") ?? "").trim();
  const usageLimit = usageLimitRaw ? Number.parseInt(usageLimitRaw, 10) : null;
  const oncePerCustomer = String(formData.get("oncePerCustomer")) === "true";
  const startsAt = parseMoment(formData.get("startsAt")) ?? new Date();
  const endsAt = parseMoment(formData.get("endsAt"));

  if (!title) return { error: "Give the discount a name." };

  if (isGift) {
    if (giftThreshold === "SPEND") {
      if (!Number.isFinite(minSpend) || minSpend <= 0) {
        return { error: "Enter the minimum spend that earns the gift." };
      }
    } else if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: "Enter how many items must be bought (1 or more)." };
    }
    if (typeof giftProduct?.id !== "string") {
      return { error: "Choose the gift product." };
    }
    if (!Number.isFinite(giftPrice) || giftPrice < 0) {
      return { error: "Enter the gift price (0 for free)." };
    }
  } else {
    if (!Number.isInteger(quantity) || quantity < 2) {
      return { error: "A bundle needs at least 2 items." };
    }
    if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) {
      return { error: "Enter what the bundle should cost." };
    }
  }

  if (selection.length === 0) {
    return {
      error:
        selectionMode === DISCOUNT_SELECTION.COLLECTIONS
          ? "Choose at least one collection."
          : "Choose at least one product.",
    };
  }
  if (isLink && !landingPath) {
    return {
      error:
        "Enter the page the link should open, e.g. /pages/bundle-offer or the full page address.",
    };
  }
  if (usesCode(method)) {
    if (!code) return { error: "Enter a discount code, or press Generate." };
    if (!/^[A-Z0-9_-]{3,255}$/.test(code)) {
      return {
        error:
          "Use only letters, numbers, dashes and underscores in the code (at least 3).",
      };
    }
    if (
      usageLimit !== null &&
      (!Number.isInteger(usageLimit) || usageLimit < 1)
    ) {
      return { error: "Total uses must be a whole number of 1 or more." };
    }
  }
  if (endsAt && endsAt <= startsAt) {
    return { error: "The end time must be after the start time." };
  }
  if (endsAt && endsAt <= new Date()) {
    return { error: "The end time has already passed. Pick a later one." };
  }

  const result = await createBundleDiscount(admin, session.shop, {
    kind,
    title,
    quantity,
    bundlePrice,
    giftPrice,
    giftProduct: isGift
      ? { id: giftProduct.id, title: String(giftProduct.title ?? "Gift") }
      : null,
    giftRepeats,
    giftThreshold,
    minSpend,
    selectionMode,
    selection,
    method,
    code,
    landingPath,
    usageLimit,
    oncePerCustomer,
    startsAt,
    endsAt,
    currencyCode: await getShopCurrency(admin),
    session,
  });

  if (result.error) return { error: result.error };

  return redirect(`/app/discounts/${result.discount.id}?created=1`);
};

export default function NewDiscount() {
  const { currencyCode } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const money = (amount) => formatMoney(amount, currencyCode);

  const [kind, setKind] = useState(DISCOUNT_KIND.BUNDLE);
  const isGift = kind === DISCOUNT_KIND.GIFT;

  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("3");
  const [bundlePrice, setBundlePrice] = useState("");
  const [giftProduct, setGiftProduct] = useState(null);
  const [giftPrice, setGiftPrice] = useState("1");
  const [giftRepeats, setGiftRepeats] = useState(false);
  const [giftThreshold, setGiftThreshold] = useState("ITEMS");
  const [minSpend, setMinSpend] = useState("");
  const bySpend = giftThreshold === "SPEND";
  const [selectionMode, setSelectionMode] = useState(
    DISCOUNT_SELECTION.PRODUCTS,
  );
  const [selection, setSelection] = useState([]);
  const [method, setMethod] = useState(DISCOUNT_METHOD.AUTOMATIC);
  const [code, setCode] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [oncePerCustomer, setOncePerCustomer] = useState(false);
  const [landingPath, setLandingPath] = useState("");
  const isCode = method === DISCOUNT_METHOD.CODE;
  const isLink = method === DISCOUNT_METHOD.LINK;
  const [schedule, setSchedule] = useState({
    startDate: "",
    startTime: "00:00",
    endDate: "",
    endTime: "23:59",
  });

  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;
  const isCollections = selectionMode === DISCOUNT_SELECTION.COLLECTIONS;

  const count = Number.parseInt(quantity, 10);
  const price = Number.parseFloat(bundlePrice);
  const giftAmount = Number.parseFloat(giftPrice);
  const bundleReady = Number.isInteger(count) && count >= 2 && price > 0;
  const spend = Number.parseFloat(minSpend);
  const giftReady =
    (bySpend ? spend > 0 : Number.isInteger(count) && count >= 1) &&
    giftAmount >= 0 &&
    giftProduct;
  // How the gift is earned, in a few words, e.g. "Buy 3" or "Spend $50.00".
  const earnText = bySpend ? `Spend ${money(spend)}` : `Buy ${count}`;

  const startMoment = toMoment(schedule.startDate, schedule.startTime);
  const endMoment = toMoment(schedule.endDate, schedule.endTime);

  // A worked bundle example so the merchant can see the offer as a customer
  // would, using items priced so the bundle is a real saving.
  const examplePrice = bundleReady ? Math.ceil((price / count) * 1.4) : 0;
  const exampleTotal = examplePrice * count;

  const pick = async () => {
    const picked = await shopify.resourcePicker({
      type: isCollections ? "collection" : "product",
      multiple: true,
      selectionIds: selection.map((entry) => ({ id: entry.id })),
    });
    // The picker resolves to nothing when dismissed; keep what was chosen.
    if (!picked) return;
    setSelection(picked.map(({ id, title: name }) => ({ id, title: name })));
  };

  const pickGift = async () => {
    const picked = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      selectionIds: giftProduct ? [{ id: giftProduct.id }] : [],
    });
    if (!picked?.[0]) return;
    setGiftProduct({ id: picked[0].id, title: picked[0].title });
  };

  const switchMode = (event) => {
    setSelectionMode(event.target.value);
    // Products and collections are different lists; carrying one over as the
    // other would quietly discount the wrong things.
    setSelection([]);
  };

  const updateSchedule = (key) => (event) =>
    setSchedule((current) => ({ ...current, [key]: event.target.value }));

  const save = () =>
    fetcher.submit(
      {
        kind,
        title,
        bundlePrice: isGift ? "" : bundlePrice,
        giftPrice: isGift ? giftPrice : "",
        giftProduct: isGift && giftProduct ? JSON.stringify(giftProduct) : "",
        giftRepeats: String(isGift && giftRepeats),
        giftThreshold,
        minSpend: isGift && bySpend ? minSpend : "",
        // Unused for spend gifts, but the column needs a number.
        quantity: isGift && bySpend ? "0" : quantity,
        selectionMode,
        selection: JSON.stringify(selection),
        method,
        code: isCode ? code : "",
        landingPath: isLink ? landingPath : "",
        usageLimit: isCode || isLink ? usageLimit : "",
        oncePerCustomer: String((isCode || isLink) && oncePerCustomer),
        startsAt: startMoment,
        endsAt: endMoment,
      },
      { method: "POST" },
    );

  return (
    <s-page heading="Create discount" inlineSize="base">
      <s-button slot="secondary-actions" href="/app/discounts">
        Cancel
      </s-button>

      {error && (
        <s-banner tone="critical" heading="The discount was not created">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Offer type">
        <s-choice-list
          label="Offer type"
          labelAccessibilityVisibility="exclusive"
          values={[kind]}
          onChange={(event) => {
            const [selected] = event.currentTarget.values ?? [];
            if (selected) setKind(selected);
          }}
        >
          <s-choice value={DISCOUNT_KIND.BUNDLE}>
            Bundle price
            <s-text slot="details">
              {`A set of items for one price, e.g. any 3 for ${money(55)}.`}
            </s-text>
          </s-choice>
          <s-choice value={DISCOUNT_KIND.GIFT}>
            Gift with purchase
            <s-text slot="details">
              {`Buy items, get a gift product for a set price, e.g. buy 3, get a tote bag for ${money(1)}. Stacks with your other discounts.`}
            </s-text>
          </s-choice>
        </s-choice-list>
      </s-section>

      <s-section heading={isGift ? "Gift offer" : "Bundle offer"}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Prices on your products do not change; the saving is taken off at
            checkout.
          </s-paragraph>
          <s-text-field
            label="Discount name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              isGift ? "Buy 3 get a tote for 1" : "3 for 55 summer offer"
            }
            details="For you and your staff. Customers see the offer itself."
          />

          {isGift ? (
            <s-stack direction="block" gap="base">
              <s-select
                label="Earn the gift by"
                value={giftThreshold}
                onChange={(event) => setGiftThreshold(event.target.value)}
              >
                <s-option value="ITEMS">Number of items bought</s-option>
                <s-option value="SPEND">Amount spent</s-option>
              </s-select>
              <s-grid
                gap="base"
                gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              >
                {bySpend ? (
                  <s-number-field
                    label={`Minimum spend (${currencyCode})`}
                    value={minSpend}
                    onChange={(event) => setMinSpend(event.target.value)}
                    min={0}
                    step={0.01}
                    details="Spent on qualifying items, not counting the gift."
                  />
                ) : (
                  <s-number-field
                    label="Items to buy"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    min={1}
                    step={1}
                    details="How many qualifying items earn the gift."
                  />
                )}
                <s-number-field
                  label={`Gift price (${currencyCode})`}
                  value={giftPrice}
                  onChange={(event) => setGiftPrice(event.target.value)}
                  min={0}
                  step={0.01}
                  details="What the gift costs once earned. 0 makes it free."
                />
              </s-grid>
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Gift product</s-text>
                <s-paragraph>
                  {giftProduct
                    ? giftProduct.title
                    : "No gift chosen yet. Every variant of the product can be the gift."}
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button onClick={pickGift}>
                    {giftProduct ? "Change gift" : "Choose gift product"}
                  </s-button>
                </s-stack>
              </s-stack>
              <s-checkbox
                label={
                  bySpend
                    ? `Give a gift for every ${spend > 0 ? money(spend) : "minimum spend"} spent`
                    : `Give a gift for every ${Number.isInteger(count) && count > 0 ? count : "set of items"} bought`
                }
                details={
                  bySpend
                    ? "Off: one gift per order. On: spend twice as much, get two gifts."
                    : "Off: one gift per order. On: buy twice as many, get two gifts."
                }
                checked={giftRepeats}
                onChange={(event) => setGiftRepeats(event.currentTarget.checked)}
              />
            </s-stack>
          ) : (
            <s-grid
              gap="base"
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            >
              <s-number-field
                label="Items in the bundle"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                min={2}
                step={1}
                details="How many items the customer must buy."
              />
              <s-number-field
                label={`Bundle price (${currencyCode})`}
                value={bundlePrice}
                onChange={(event) => setBundlePrice(event.target.value)}
                min={0}
                step={0.01}
                details="What all of those items cost together."
              />
            </s-grid>
          )}

          {isGift && giftReady && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">
                  {`${isCode ? `With code ${code || "your code"}: ` : ""}${earnText}, get ${giftProduct.title} for ${money(giftAmount)}`}
                </s-text>
                <s-text>
                  {bySpend
                    ? `Once a customer has spent ${money(spend)} on qualifying items, ${giftProduct.title} drops to ${money(giftAmount)}${giftRepeats ? `, one for every ${money(spend)} spent` : ", once per order"}.`
                    : `Once a customer has ${count} qualifying item${count === 1 ? "" : "s"} in their cart, ${giftProduct.title} drops to ${money(giftAmount)}${giftRepeats ? `, one for every ${count} bought` : ", once per order"}.`}
                </s-text>
                <s-text color="subdued">
                  The customer adds the gift to their cart themselves — a
                  discount cannot add products. If the gift is also a qualifying
                  item, it does not count towards its own purchase. Stacks with
                  your other discounts.
                </s-text>
              </s-stack>
            </s-box>
          )}

          {!isGift && bundleReady && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">
                  {isCode
                    ? `Customers enter ${code || "your code"} at checkout and get ${count} for ${money(price)}`
                    : `Customers see: “${count} for ${money(price)}” in their cart`}
                </s-text>
                <s-text>
                  {`Example: ${count} items at ${money(examplePrice)} each would normally cost ${money(exampleTotal)}. With this offer they pay ${money(price)}, saving ${money(exampleTotal - price)}.`}
                </s-text>
                <s-text color="subdued">
                  {`Every full set of ${count} gets the price, so ${count * 2} items cost ${money(price * 2)}. Extra items beyond a full set pay full price. Items can be mixed, and the dearest ones are bundled first. A set already cheaper than ${money(price)} is left as it is.`}
                </s-text>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section heading={isGift ? "Items that earn the gift" : "Applies to"}>
        <s-stack direction="block" gap="base">
          <s-select
            label={
              isGift
                ? "Which items count towards the purchase?"
                : "Which items count towards the bundle?"
            }
            value={selectionMode}
            onChange={switchMode}
          >
            <s-option value={DISCOUNT_SELECTION.PRODUCTS}>
              Specific products
            </s-option>
            <s-option value={DISCOUNT_SELECTION.COLLECTIONS}>
              Products in collections
            </s-option>
          </s-select>
          <s-paragraph>
            {selection.length === 0
              ? isCollections
                ? "No collections chosen yet. Products added to a chosen collection later are included automatically."
                : "No products chosen yet. Every variant of a chosen product counts."
              : `${selection.length} ${isCollections ? "collection" : "product"}${selection.length === 1 ? "" : "s"} chosen: ${selection
                  .slice(0, 5)
                  .map((entry) => entry.title)
                  .join(", ")}${selection.length > 5 ? "…" : ""}`}
          </s-paragraph>
          <s-stack direction="inline">
            <s-button onClick={pick}>
              {isCollections ? "Choose collections" : "Choose products"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="How customers get it">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Method"
            labelAccessibilityVisibility="exclusive"
            values={[method]}
            onChange={(event) => {
              const [selected] = event.currentTarget.values ?? [];
              if (selected) setMethod(selected);
            }}
          >
            <s-choice value={DISCOUNT_METHOD.AUTOMATIC}>
              Automatic
              <s-text slot="details">
                Applies by itself in the cart when the items are added. No
                code to share.
              </s-text>
            </s-choice>
            <s-choice value={DISCOUNT_METHOD.CODE}>
              Discount code
              <s-text slot="details">
                Customers type a code at checkout. Good for emails, social
                posts and influencers.
              </s-text>
            </s-choice>
            <s-choice value={DISCOUNT_METHOD.LINK}>
              Special link only
              <s-text slot="details">
                Only customers who open your link get it. The link switches the
                offer on and takes them to the page you choose — no code to
                type.
              </s-text>
            </s-choice>
          </s-choice-list>

          {isLink && (
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Page the link opens"
                value={landingPath}
                onChange={(event) => setLandingPath(event.target.value)}
                placeholder="/pages/bundle-offer"
                details="A page in your store, as a path or full address. Leave empty for the home page. The link is shown on the discount's page once it is created."
              />
              <s-grid
                gap="base"
                gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              >
                <s-number-field
                  label="Total uses allowed (optional)"
                  value={usageLimit}
                  onChange={(event) => setUsageLimit(event.target.value)}
                  min={1}
                  step={1}
                  details="Leave empty for no limit."
                />
              </s-grid>
              <s-checkbox
                label="Limit to one use per customer"
                checked={oncePerCustomer}
                onChange={(event) =>
                  setOncePerCustomer(event.currentTarget.checked)
                }
              />
            </s-stack>
          )}

          {isCode && (
            <s-stack direction="block" gap="base">
              <s-grid
                gap="base"
                gridTemplateColumns="minmax(0, 1fr) auto"
                alignItems="end"
              >
                <s-text-field
                  label="Discount code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase().replace(/\s+/g, ""))
                  }
                  placeholder="SUMMER55"
                  details="What customers type at checkout. Must not already be used by another discount."
                />
                <s-button onClick={() => setCode(generateCode())}>
                  Generate
                </s-button>
              </s-grid>
              <s-grid
                gap="base"
                gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              >
                <s-number-field
                  label="Total uses allowed (optional)"
                  value={usageLimit}
                  onChange={(event) => setUsageLimit(event.target.value)}
                  min={1}
                  step={1}
                  details="Leave empty for no limit."
                />
              </s-grid>
              <s-checkbox
                label="Limit to one use per customer"
                checked={oncePerCustomer}
                onChange={(event) =>
                  setOncePerCustomer(event.currentTarget.checked)
                }
              />
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="When it runs">
        <s-stack direction="block" gap="base">
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
          >
            <s-date-field
              label="Start date (optional)"
              value={schedule.startDate}
              onChange={updateSchedule("startDate")}
              details="Leave empty to start straight away"
            />
            <s-select
              label="Start time"
              value={schedule.startTime}
              onChange={updateSchedule("startTime")}
              disabled={!schedule.startDate}
            >
              {TIMES.map((time) => (
                <s-option key={time} value={time}>
                  {timeLabel(time)}
                </s-option>
              ))}
            </s-select>
            <s-date-field
              label="End date (optional)"
              value={schedule.endDate}
              onChange={updateSchedule("endDate")}
              details="Leave empty to run until you end it"
            />
            <s-select
              label="End time"
              value={schedule.endTime}
              onChange={updateSchedule("endTime")}
              disabled={!schedule.endDate}
            >
              {END_TIMES.map((time) => (
                <s-option key={time} value={time}>
                  {timeLabel(time)}
                </s-option>
              ))}
            </s-select>
          </s-grid>
          <s-paragraph color="subdued">
            {startMoment && new Date(startMoment) > new Date()
              ? `Starts ${formatDateTime(startMoment)}`
              : "Starts as soon as you create it"}
            {endMoment
              ? ` and ends ${formatDateTime(endMoment)}.`
              : " and runs until you end it."}{" "}
            Times are in your timezone. Shopify switches the discount on and
            off by itself.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button
          variant="primary"
          onClick={save}
          {...(busy ? { loading: true } : {})}
        >
          Create discount
        </s-button>
        <s-button variant="tertiary" href="/app/discounts">
          Cancel
        </s-button>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
