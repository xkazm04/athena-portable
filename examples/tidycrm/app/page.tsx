import type { Metadata } from "next";
import { Archivo, Literata, Martian_Mono } from "next/font/google";

import { Blocks } from "@/components/blocks/Blocks";
import { buildSheet } from "@/lib/blocks";

/**
 * The Blocks, at the root (design 4.6.4). One app, one screen.
 *
 * This route was a redirect to `/v`, an index of design directions, with the one shipped direction
 * a level below it at `/v/blocks`. The index is gone: a host app in the demo is a tab the user
 * already has open, and a tab whose front door is a menu of unbuilt drafts is not that. So the
 * sheet is `/`, the index and its route are deleted, and `navigate(blocks)` and every bookmark
 * land on the thing itself.
 *
 * The three faces and the metadata came up with the page from `app/v/blocks/layout.tsx`, which had
 * no other child: a layout that wraps exactly one page is a file, not a boundary. `next/font` is
 * evaluated at module scope here, so the faces are still self-hosted and there is no runtime font
 * request.
 */
export const metadata: Metadata = {
  title: "TidyCRM — the Blocks",
  description:
    "The same check print read at three depths: four axonometric survey boxes, one zone as a ruled row list, one block marked up with its rows and its evidence.",
};

export const dynamic = "force-dynamic";

/*
 * The same three faces the `law` direction settled on, and that is the point.
 *
 * What the office PRINTED is drafted Archivo caps, what a person WROTE in the margin is Literata,
 * and every figure is narrow-pinned Martian Mono with tabular numerals. The written design law is
 * `design/pass3-law-brief.md`.
 */
const draft = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-bk-draft" });
const note = Literata({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bk-note" });
const fig = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-bk-fig" });

const FONT_CLASSES = [draft, note, fig].map((f) => f.variable).join(" ");

/*
 * Real seeded data through `lib/db.ts`, read in a server component, with no mock array anywhere.
 * One read, one prop: every level's data is in the payload before the first frame, because a
 * direction whose claim is a seamless zoom cannot fetch on the way in.
 */
export default function RootPage() {
  return (
    <div className={FONT_CLASSES}>
      <Blocks sheet={buildSheet()} />
    </div>
  );
}
