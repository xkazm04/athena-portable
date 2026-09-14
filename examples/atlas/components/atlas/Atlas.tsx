"use client";

/**
 * Atlas — this repository, read at three altitudes.
 *
 *   L0  the plate: seventeen concepts this repository claims, over the six layers it is made of
 *   L1  one layer: its systems laid side by side to compare, and what it connects to
 *   L2  one component: what it enforces, who calls it, which claims it carries, which ADR decided it
 *
 * WHAT THIS FILE IS FOR. Atlas is round 2's objective test of the layered-UI formula: an app built
 * ONLY through `@athena/demo-kit`'s primitives, whose count of "I had to write this myself" is the
 * distance from a reusable formula (`docs/layered-ui-formula.md` §2). So every rule of §1 that the
 * kit holds is used here as the kit holds it, and everything this file had to invent is logged as
 * one dated bullet in `KIT-GAPS.md`. Read that file next to this one.
 *
 * The nine rules, and where each one is:
 *
 *   1. the level you LEAVE carries the camera — `Echo` below, on `flight.from`
 *   2. one claimant per shared id — `sharedIdentity` / `useSharedIdentity`, ids in `motion.ts`
 *   3. box, then ink — `m.inkIn` is delayed by a whole `move`; the echo's ink leaves first
 *   4. one clock — `motion.ts` reads `--at-dur-*` out of the cascade and types no millisecond
 *   5. the overlay owns its Escape and hands focus back — `useOverlayEscape` in `level2/Pane.tsx`
 *   6. a move in flight is abortable — `useLevelFlight` wires `nav.setMoving`; nothing is disabled
 *   7. presence comes from the model — `presenceOf`, on the component rows
 *   8. reduced motion lands on the final state at frame zero — `INSTANT`, and no echo at all
 *   9. what is no longer seen costs nothing — there is no renderer here; a settled Atlas draws zero
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useLevelFlight, useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import {
  COUNTS,
  componentById,
  highlightIds,
  layerById,
  lensFor,
  type Lens,
} from "@/data";

import { Mast } from "./Mast";
import { useAtlasMotion } from "./motion";
import { Index } from "./level0/Index";
import { Layer } from "./level1/Layer";
import { Pane } from "./level2/Pane";
import { AtlasTools } from "./tools/AtlasTools";

export function Atlas() {
  const nav = useZoomNav();
  const m = useAtlasMotion();
  /* The safety net only: `settle()` from the move's own completion is what normally ends a
     flight, so the level change ends when the motion does rather than at a typed number. */
  const flight = useLevelFlight(nav, { fallbackToken: "--at-dur-move" });

  /*
   * THE LENS. A concept id is the only local state in this app, and it is not the authority: the
   * authority is `nav.state.highlight`, the kit model's own answer to "what is something pointing
   * at". This holds the id so the mast can name it and `set_lens` can report it; the effect below
   * expresses it downward, and every cell asks the MODEL whether it is lit. That is rule 7 applied
   * one level up from presence — the surface never re-derives what is marked.
   */
  const [lensId, setLensId] = useState<string | null>(null);
  const lens: Lens = useMemo(() => lensFor(lensId), [lensId]);

  /* `nav.highlight` is re-created on every nav state change, so it is read through a ref: this
     effect must run when the LENS changes and not when the nav does. */
  const highlight = useRef(nav.highlight);
  useEffect(() => {
    highlight.current = nav.highlight;
  });
  useEffect(() => {
    highlight.current(highlightIds(lensFor(lensId)));
  }, [lensId]);

  const setLens = useCallback((id: string | null) => {
    setLensId((current) => (current === id ? null : id));
  }, []);

  const focus: Focus = nav.state.focus;
  const layer = layerById(focus.group);
  const open = componentById(focus.item);

  /*
   * FOCUS FOLLOWS THE LEVEL. The kit moves the nav, not the caret: `useOverlayEscape` hands focus
   * back from an overlay, but a L0 -> L1 change leaves the reader's focus on a button that has
   * just been unmounted, which drops them at the top of the document. So the arriving level is
   * focused once, on the frame it settles. (KIT-GAPS.md, 2026-09-14, #3.)
   */
  const liveRef = useRef<HTMLDivElement | null>(null);
  const landed = useRef(focus.level);
  useEffect(() => {
    const from = landed.current;
    if (from === focus.level) return;
    landed.current = focus.level;
    /* L2 is an overlay and moves focus itself, and on the way OUT of it `useOverlayEscape` returns
       focus to whatever opened it. Neither direction is this effect's business: two things
       reaching for the caret in the same commit is a race whose winner is a frame ordering. */
    if (focus.level === 2 || from === 2) return;
    const target = liveRef.current?.querySelector<HTMLElement>("[data-arrival]");
    target?.focus({ preventScroll: true });
  }, [focus.level]);

  /*
   * RULE 1. The echo is the level being LEFT, rendered once more as an inert, id-free copy with
   * the whole camera on it, so the live layer mounts at its final size and the shared-element
   * morph is never measured inside an animating ancestor.
   *
   * Only for L0 <-> L1, which is the move that changes what the sheet IS. L1 -> L2 is a morph out
   * of a row that stays on screen: there is nothing being left, so an echo there would be a second
   * copy of a level the reader can still see.
   */
  const crossing = flight.from.level !== focus.level;
  const echoing =
    !m.reduced && flight.moving && crossing && (flight.from.level === 0 || focus.level === 0);
  const zoomingIn = focus.level > flight.from.level;

  return (
    <MotionConfig reducedMotion="user">
      <AtlasTools nav={nav} lens={lens} lensId={lensId} setLens={setLens} />
      <div className="at-app" data-level={focus.level}>
        <Mast nav={nav} lens={lens} setLens={setLens} counts={COUNTS} />

        <div className="at-plate">
          <LayoutGroup>
            <section className="at-levels">
              {/*
               * The completion signal: zero-size, keyed on the flight, running the move this
               * level change is actually running — so the flight ends with the motion rather than
               * at a number somebody typed.
               */}
              <motion.span
                key={flight.flight}
                className="at-flight"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={m.move}
                onAnimationComplete={() => flight.settle()}
              />

              <AnimatePresence>
                {echoing ? (
                  <motion.div
                    key={`echo-${flight.flight}`}
                    className="at-echo"
                    aria-hidden
                    inert
                    initial={{ opacity: 1, scale: 1 }}
                    animate={{ opacity: 0, scale: zoomingIn ? 1.06 : 0.96 }}
                    transition={m.move}
                  >
                    {/* Rule 3 the way back — the echo's SECONDARY ink leaves over `--at-dur-ink`
                        while the boxes are still travelling over `--at-dur-move`. It is a CSS
                        animation scoped by `.at-echo` in `style/base/sheet.css`, not a second
                        motion layer here: one fading wrapper faded the boxes with the text and
                        the whole echo disappeared a third of the way through its own move. */}
                    {flight.from.level === 0 ? (
                      <Index echo lens={lens} nav={nav} setLens={setLens} />
                    ) : (
                      <Layer echo layerId={flight.from.group} lens={lens} nav={nav} />
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="at-live" ref={liveRef}>
                {focus.level === 0 ? (
                  <Index lens={lens} nav={nav} setLens={setLens} />
                ) : layer ? (
                  <Layer layerId={layer.id} lens={lens} nav={nav} />
                ) : null}
              </div>
            </section>

            {open ? <Pane component={open} nav={nav} lens={lens} setLens={setLens} /> : null}
          </LayoutGroup>
        </div>

        <footer className="at-foot">
          <span>
            Atlas reads this repository at three altitudes. The model was extracted by hand from
            README.md, docs/adr/*, AGENTS.md and the packages&rsquo; own module headers; every entry
            cites the file it came from. Nothing is fetched.
          </span>
          <span className="at-fig">
            {COUNTS.concepts} concepts &middot; {COUNTS.systems} systems &middot;{" "}
            {COUNTS.components} components &middot; {COUNTS.edges} edges
          </span>
        </footer>
      </div>
    </MotionConfig>
  );
}
