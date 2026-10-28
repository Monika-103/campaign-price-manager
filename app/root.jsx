import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
// `?url` gives the built file's path so it can be declared as a real
// stylesheet link below. A plain side-effect import relies on the JS bundle to
// inject it, which left the page unstyled until hydration -- and never at all
// on the server-rendered first paint.
import globalStyles from "./styles/global.css?url";

export const links = () => [{ rel: "stylesheet", href: globalStyles }];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
