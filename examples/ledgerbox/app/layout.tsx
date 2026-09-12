import type { Metadata } from "next";
import { Anton, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Ledgerbox — the Lanes",
  description:
    "Six chronological swimlanes, one per area of the practice, over three zoom levels: the swarm, one lane spread, one invoice lifted. Ships without Athena; every capability is registered and waiting.",
  // App identity for a WebMCP consumer: origin comes from the page, app_id and version from here.
  other: { "athena:app": "ledgerbox", "athena:app-version": "0.1.0" },
};

// The books are read per request; nothing here is prerendered.
export const dynamic = "force-dynamic";

/*
 * Three faces, and the scale contrast between them is the point.
 *
 * The reference this direction was pointed at gets almost all of its quality from one device: a
 * very large, very heavy CONDENSED face set in caps with the leading closed right up, sitting
 * against 11px tracked-out caps labels. Nothing in between. So `Anton` carries the masthead and
 * the headline figures — a single-weight condensed grotesque, which is exactly the cut that reads
 * as a poster rather than as a dashboard heading — and every label under it is mono at 11px with
 * 0.2em of tracking.
 *
 * `Space Grotesk` is the UI text face, and `IBM Plex Mono` every figure that has to be compared
 * down a column, because a proportional digit makes that comparison a guess.
 *
 * They load here rather than in a per-direction layout because there is one direction and it is
 * the root route.
 */
const display = Anton({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-ln-display",
  display: "swap",
});

const text = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ln-text",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ln-mono",
  display: "swap",
});

const FONTS = [display, text, mono].map((f) => f.variable).join(" ");

/**
 * Document, providers, faces, and the one shell the direction needs.
 *
 * `.ln-shell` exists for one reason: a container query can never apply to its own container.
 * `.ln-root` names itself and every descendant queries it happily, but the handful of
 * narrow-layout rules that have to change something ON the root — its height model, its padding,
 * the gutter width it hands down — were silently doing nothing at 390px. The shell is the
 * container those rules query.
 *
 * There is no capability registrar here. A surface's capabilities are registered by that surface,
 * on `document.modelContext`: `components/lanes/tools/` mounts with the Lanes, which is the one
 * page this app has.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className={`ln-shell ${FONTS}`}>{children}</div>
        </Providers>
      </body>
    </html>
  );
}
