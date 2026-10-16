import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { HostCapabilities } from "@/components/shell/HostCapabilities";
import { defectCounts } from "@/lib/db";
import { APP_ID, APP_VERSION } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "tidycrm",
  description:
    "Contact-list cleanup before a campaign: duplicates, phone formats, stale records and company-name conflicts. Ships without Athena.",
  /*
   * App identity for a WebMCP consumer: the origin comes from the page, `app_id` and the version
   * from here. Without it `inject.js` falls back to the origin's host and the daemon refuses the
   * whole manifest — "app_id must be a slug: 'localhost:3004'" — so every capability this app
   * registers was unreachable, on every route. ledgerbox declares the same pair in its own shipped
   * layout; this one belongs on the root layout because `HostCapabilities` is mounted there and
   * the identity has to cover every segment beneath it.
   */
  other: { "athena:app": APP_ID, "athena:app-version": APP_VERSION },
};

/*
 * The root layout owns html/body, the providers and the capability manifest, and nothing else.
 * The one screen brings the rest: its `next/font` faces are evaluated in `app/page.tsx`, and its
 * `data-variant` is set on The Blocks' own root element (`components/blocks/Blocks.tsx`) rather
 * than on <html>, so nothing here has to change when the screen does.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const counts = defectCounts();
  return (
    <html lang="en">
      <body>
        <Providers>
          {/* Registers the manifest entries once, above every segment. Must be inside the provider. */}
          <Suspense fallback={null}>
            <HostCapabilities counts={counts} />
          </Suspense>
          {children}
        </Providers>
      </body>
    </html>
  );
}
