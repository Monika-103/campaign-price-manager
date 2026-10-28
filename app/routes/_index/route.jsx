import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // Shopify loads an embedded app at the root with these parameters. Any one of
  // them means we are inside the admin, so send the merchant straight to the
  // app rather than showing them a sign-in form for a store they are already
  // signed in to. Only `shop` was checked before, so an admin load that carried
  // just `host` and `embedded` fell through to the public page.
  const isEmbeddedLoad =
    url.searchParams.has("shop") ||
    url.searchParams.has("host") ||
    url.searchParams.get("embedded") === "1";

  if (isEmbeddedLoad) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

// Each icon is a set of paths on a 24×24 line-icon grid. They are drawn inside
// one shared <svg> below, so every card's icon has the same size and stroke.
const FEATURES = [
  {
    title: "Campaigns that undo themselves",
    body: "Every original price is stored on the variant before it changes, so a sale can be reversed exactly — even months later.",
    icon: (
      <>
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
      </>
    ),
  },
  {
    title: "Pick products your way",
    body: "Choose products or whole collections, or upload a sheet of SKUs. A sheet can carry its own RRP, price and per-row discount.",
    icon: (
      <>
        <path d="m3 17 2 2 4-4" />
        <path d="m3 7 2 2 4-4" />
        <path d="M13 6h8" />
        <path d="M13 12h8" />
        <path d="M13 18h8" />
      </>
    ),
  },
  {
    title: "Five pricing rules",
    body: "Set a fixed price, take a percentage off the selling or compare-at price, move the current price into compare-at, or use the figures in your sheet. Round to .99, .95 or whole numbers.",
    icon: (
      <>
        <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </>
    ),
  },
  {
    title: "See it before you do it",
    body: "The preview shows every before-and-after, names the variants it cannot touch, and flags any price falling by more than half.",
    icon: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    title: "No accidental double discounts",
    body: "Products already in a running campaign are held back and listed by SKU, so a second campaign can never overwrite the true original price.",
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    title: "Bundle offers",
    body: "Sell a set for one price, like any 3 for 55. The saving is taken off at checkout, so product prices never change, and it starts and stops on the times you set.",
    icon: (
      <>
        <path d="M21 8 12 3 3 8l9 5z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </>
    ),
  },
];

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Campaign Manager</h1>
        <p className={styles.text}>
          Run bulk price changes across your catalogue with confidence. Preview
          every change before it goes live, and put the original prices back
          whenever you want.
        </p>
        <ul className={styles.list}>
          {FEATURES.map(({ title, body, icon }) => (
            <li key={title}>
              <span className={styles.icon} aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icon}
                </svg>
              </span>
              <strong>{title}</strong> {body}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
