import type { Metadata } from "next";
import { Chivo, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { VARIANT } from "@/lib/constants";

/*
 * Two faces, no third (DESIGN.md §3): the drawn voice and the figure face. `next/font` downloads
 * and SELF-HOSTS them at build time, so there is no runtime font request — repo law. The
 * `--font-*` variables are what `--at-font-draft` and `--at-font-fig` alias, and both tokens name
 * a real fallback stack, so a build with no font step renders the same layout in system faces.
 */
const draft = Chivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  variable: "--font-draft",
  display: "swap",
});

const fig = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-fig",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas — Athena Portable as a blueprint",
  description:
    "This repository's own architecture as a 2D blueprint: nineteen systems and sixty-eight modules on one sheet, rows for layers and columns for kinds, read at three depths. Ships without Athena.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-variant={VARIANT} className={`${draft.variable} ${fig.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
