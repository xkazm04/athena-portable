import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Ledgerbox",
  description:
    "Invoice and expense inbox for a two-person studio. Ships without Athena; every UI action is registered and waiting.",
};

// The books are read per request; nothing here is prerendered.
export const dynamic = "force-dynamic";

/**
 * Document and providers. Nothing visual.
 *
 * The shipped design owns its own shell, its own `data-variant` wrapper and its own fonts, in
 * `app/(shipped)/layout.tsx`. The route group is invisible: `/` is still `/`.
 *
 * There is no capability registrar here any more. A surface's capabilities are
 * registered by that surface, on `document.modelContext`, so what an agent can
 * see is exactly what is on screen — the Strip's tools mount with the Strip and
 * the Lanes' tools with the Lanes, rather than one app-wide component
 * publishing every tool in the app from a route where most of them mean
 * nothing.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
