"use client";

/**
 * ATLAS — this repository's architecture, drawn three ways behind one switcher.
 *
 * ROUND 5, AND WHY. Round 4 answered the owner's verdict on round 3 with one 2D blueprint and the
 * rubric moved, but a single direction cannot tell you whether it is the RIGHT direction — the
 * lesson rounds 2 and 3 paid for twice ("our adjustments are too careful… we are polishing versions
 * we are stuck with"). So round 5 builds three drawings over one model: the blueprint evolved, the
 * archify grammar transposed, and one wildcard, and the reader switches between them in the mast.
 *
 * WHAT THIS FILE IS NOW: nothing but the mount point. Everything that was here in round 4 moved to
 * one of two places, and the line between them is `variants/contract.ts`:
 *
 *   the shell      `variants/Shell.tsx` — the nav, the flight, the lens, the `lit` set, reduced
 *                  motion, the L2 pane, the mast, the claims rail, the tools, and the `?variant=`
 *                  choice. One model, one level semantics, one details destination, three drawings.
 *   the variant    `variants/<slug>/index.tsx` — everything inside the stage: layout, camera,
 *                  bands, views, legend, story. The blueprint's is `variants/blueprint/`.
 *
 * WHERE THE SIXTEEN RULES OF THE FORMULA LIVE is therefore also split, and that split is itself a
 * finding worth the round: rules 4, 5, 6, 7 and 8 turn out to be SHELL rules — one clock, one
 * overlay Escape, one abortable flight, one presence source, one reduced-motion branch — while
 * rules 10 to 16 are all about how a variant renders a camera and are the variant's own. A rule
 * that can be held in the shell is a rule the next app gets for free.
 */
import { Shell } from "./variants/Shell";

export function Atlas() {
  return <Shell />;
}
