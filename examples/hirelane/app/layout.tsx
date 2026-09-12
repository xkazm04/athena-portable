import type { Metadata } from "next";
import { Caveat, JetBrains_Mono, Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { HostCapabilities } from "@/components/HostCapabilities";
import { STUDIO } from "@athena/demo-kit/seed";

export const metadata: Metadata = {
  title: `Hirelane — ${STUDIO.name}`,
  description:
    "A lit contact sheet over three levels: the pipeline grouped by role, a carousel that holds three candidates under the loupe, and a full dossier with the peer bench beside it.",
};

/*
 * Four faces, each with one job.
 *
 * `Sora` carries the display voice: geometric, wide-apertured, and legible at the sizes this
 * rework raised everything to. `Plus Jakarta Sans` is the text face — the review said the previous
 * pairing did not help readability, and this is the direct answer. `JetBrains Mono` is every
 * figure, because a score is compared down a column and a proportional digit makes that a guess.
 *
 * `Caveat` is the fourth and it is rationed. It appears on marginal notes and on nothing else —
 * never on a number, a label or a control — so a hand-written line can never be mistaken for a
 * machine-produced fact. That restriction is what makes it the app's second voice rather than a
 * decorative font.
 *
 * They load here rather than in a per-direction layout because there is one direction and it is
 * the root route. `data-variant="board"` still comes from the direction's own wrapper in
 * `components/board/Board.tsx`, so the token scope is unchanged.
 */
const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-bd-display",
  display: "swap",
});

const text = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-bd-text",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-bd-mono",
  display: "swap",
});

const hand = Caveat({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-bd-hand",
  display: "swap",
});

const FONTS = [display, text, mono, hand].map((f) => f.variable).join(" ");

/**
 * The root owns html/body, the providers, the faces and the capability manifest.
 *
 * `HostCapabilities` mounts on every route now, which is one route: the screening journey needs
 * the acts and the board's own reads registered together, and the foot prints the class of the
 * union (`lib/manifest.ts`).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={FONTS}>
        <Providers>
          {/* Registers the acts. Must be inside the provider, above the pages. */}
          <HostCapabilities />
          {children}
        </Providers>
      </body>
    </html>
  );
}
