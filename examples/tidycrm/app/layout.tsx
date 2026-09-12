import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { HostCapabilities } from "@/components/shell/HostCapabilities";
import { defectCounts } from "@/lib/db";
import { APP_ID } from "@/lib/constants";

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
  other: { "athena:app": APP_ID, "athena:app-version": "0.1.0" },
};

/*
 * The root layout owns html/body, the providers and the capability manifest, and nothing else.
 * Each route segment brings its own shell, its own `next/font` faces (`app/v/blocks/layout.tsx`)
 * and its own `data-variant` wrapper (`components/blocks/Blocks.tsx`, on the direction's root
 * element rather than on a layout), so a direction can be added or removed without anything here
 * changing and without two of them fighting over a single <html> attribute.
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
