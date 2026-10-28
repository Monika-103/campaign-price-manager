// Shared formatting helpers so dates and money read the same on every screen.

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatMoney(amount, currencyCode = "USD") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number.parseFloat(String(amount));
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

// Maps a campaign status onto the label and tone of the badge that shows it.
export const STATUS_BADGE = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  ROLLING_BACK: { label: "Rolling back", tone: "warning" },
  ROLLED_BACK: { label: "Rolled back", tone: "neutral" },
  FAILED: { label: "Failed", tone: "critical" },
};

export const ITEM_BADGE = {
  PENDING: { label: "Pending", tone: "neutral" },
  UPDATED: { label: "Updated", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  RESTORED: { label: "Restored", tone: "info" },
  SUPERSEDED: { label: "Taken over", tone: "neutral" },
};

export function itemBadge(status) {
  return ITEM_BADGE[status] ?? { label: status, tone: "neutral" };
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

// How long a campaign runs, to the minute, since a campaign can start and stop
// at set times. One that starts and ends on the same day shows the date once
// ("29 Sep 2026, 2:00 PM – 6:00 PM"). A campaign with no end date is
// open-ended: it runs until its prices are restored by hand.
export function describeSchedule({ startAt, endAt }) {
  if (!endAt) return `From ${formatDateTime(startAt)} · No end date`;

  const sameDay = formatDate(startAt) === formatDate(endAt);
  return sameDay
    ? `${formatDateTime(startAt)} – ${formatTime(endAt)}`
    : `${formatDateTime(startAt)} – ${formatDateTime(endAt)}`;
}

// Turns a campaign's stored rule columns into the one-line summary shown in
// lists, e.g. "20% off compare-at price".
export function describeRule({ priceAction, applyTo, value }) {
  const source =
    applyTo === "COMPARE_AT" ? "compare-at price" : "selling price";

  switch (priceAction) {
    case "MANUAL":
      return `Set ${source} to ${value ?? "—"}`;
    case "PERCENTAGE":
      return `${value ?? 0}% off ${source}`;
    case "SELLING_TO_COMPARE":
      return value
        ? `${value}% off, old price shown as compare-at`
        : "Selling price moved to compare-at";
    case "COMPARE_TO_SELLING":
      return `${value ?? 0}% off compare-at price`;
    // Sheet rules have no single value -- every row carries its own figures --
    // so name where the prices came from instead of showing a blank dash.
    case "FROM_SHEET":
      return "Prices from sheet";
    case "SHEET_PERCENTAGE":
      return "Discount % from sheet";
    default:
      return "—";
  }
}

export function statusBadge(status) {
  return STATUS_BADGE[status] ?? { label: status, tone: "neutral" };
}

// How a person is shown in the change log. Falls back through name, then
// email, so a row is never blank when we know something about who acted.
export function describeActor({ actorName, actorEmail }) {
  if (actorName && actorEmail) return `${actorName} (${actorEmail})`;
  if (actorName) return actorName;
  if (actorEmail) return actorEmail;
  return "Unknown";
}
