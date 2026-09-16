"use client";

/**
 * ATLAS — this repository's architecture, drawn behind one switcher.
 *
 * ROUND 5 ASKED WHETHER ROUND 4 WAS THE RIGHT DRAWING, by building three over one model and letting
 * the reader compare them in the mast. The owner answered: keep the archify grammar, delete the
 * evolved blueprint and the structure matrix — *"the degradation from visual archify is significant
 * in grouping, component strategy and style"*. So one drawing survived, and round 6 asks the
 * narrower question the verdict implies: which ARCHIFY is the right archify. The switcher and the
 * contract stay exactly as they were; only the list of slugs changed.
 *
 * WHAT THIS FILE IS: nothing but the mount point. Everything that was here in round 4 lives in one
 * of two places, and the line between them is `variants/contract.ts`:
 *
 *   the shell      `variants/Shell.tsx` — the nav, the flight, the lens, the `lit` set, reduced
 *                  motion, the L2 pane, the mast, the claims rail, the tools, and the `?variant=`
 *                  choice. One model, one level semantics, one details destination, N drawings.
 *   the variant    `variants/<slug>/index.tsx` — everything inside the stage: layout, camera,
 *                  bands, views, legend, story, and any tool only that stage can answer. The one
 *                  built variant is `variants/archify/`.
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
