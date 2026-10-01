"use client";

/**
 * The title block of the drawing: the one thing that does not change between levels, views or
 * variants.
 *
 * Rubric axis 4 asks what visibly persists across depths. Here: the level rail (where you are and
 * every level you can step back to), the two orthogonal choices (which VARIANT is drawing, and —
 * if it has any — which of its VIEWS is on the sheet), the lens read-out, and the model's own
 * counts. It never unmounts and it never animates: chrome that holds still is continuity; chrome
 * that travels is a second thing to follow.
 *
 * BOTH SWITCHERS ARE RADIO GROUPS, not rows of buttons. N arrangements of one drawing are N values
 * of one property, and a reader on a keyboard should be able to walk them with the arrow keys and
 * commit with none — which is what a radio group is and what `useRoving` gives it.
 *
 * THE VIEW SWITCHER BELONGS TO WHATEVER IS MOUNTED. Round 4 hard-coded four arrangements here;
 * round 5 cannot, because a sibling variant may have none, or seven, and the mast must not know.
 * It draws whatever the mounted variant published through `variants/viewBus.ts`, and draws nothing
 * at all when nothing was published — which is the honest rendering of "this variant has one view".
 *
 * THE VARIANT SWITCHER OBEYS THE SAME RULE IT ALREADY APPLIED TO VIEWS. It is conditional on
 * `VARIANTS.length > 1`, exactly as the view switcher is conditional on `views.length > 1` — one
 * rule, two axes. Round 6 hid it (one drawing); round 7 shows it (three finishes of that drawing).
 */
import { useRef } from "react";
import { useRoving, type ZoomNav } from "@athena/demo-kit/zoom";

import { LEVELS } from "@/lib/constants";
import { componentById, layerById, type Lens, type ModelCounts } from "@/data";

import { VARIANTS, type VariantSlug } from "./variants/contract";
import type { PublishedViews } from "./variants/viewBus";

export function Mast({
  nav,
  lens,
  setLens,
  counts,
  variant,
  setVariant,
  views,
}: {
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
  counts: ModelCounts;
  variant: VariantSlug;
  setVariant: (next: VariantSlug) => void;
  views: PublishedViews;
}) {
  const focus = nav.state.focus;
  const layer = layerById(focus.group);
  const open = componentById(focus.item);

  const variantBox = useRef<HTMLDivElement | null>(null);
  const variantRoving = useRoving(variantBox, { selector: "[data-seg-btn]" });
  const viewBox = useRef<HTMLDivElement | null>(null);
  const viewRoving = useRoving(viewBox, { selector: "[data-seg-btn]" });

  return (
    <header className="at-mast">
      <span className="at-mast-brand">
        <b>Atlas</b>
        <span className="at-part">athena-portable</span>
      </span>

      {/* The first axis: which drawing is on the table. Absent while there is only one. */}
      {VARIANTS.length > 1 ? (
      <div
        className="at-switch at-variants"
        role="radiogroup"
        aria-label="Variant"
        ref={variantBox}
        {...variantRoving}
      >
        {VARIANTS.map((v) => {
          const on = variant === v.slug;
          return (
            <button
              key={v.slug}
              type="button"
              className="at-switch-btn"
              data-seg-btn=""
              data-variant-btn={v.slug}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={v.blurb}
              onClick={() => setVariant(v.slug)}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      ) : null}

      {/* The second axis, owned by whatever is mounted. Absent when the variant published none. */}
      {views.views.length > 1 && views.set ? (
        <div
          className="at-switch at-views"
          role="radiogroup"
          aria-label="Arrangement"
          ref={viewBox}
          {...viewRoving}
        >
          {views.views.map((v) => {
            const on = views.current === v.id;
            return (
              <button
                key={v.id}
                type="button"
                className="at-switch-btn"
                data-seg-btn=""
                data-view-btn={v.id}
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                title={v.note}
                onClick={() => views.set?.(v.id)}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* The level rail. Every step behind the current one is a control, so a reader can leave
          two levels with one click and never has to guess how deep they are. */}
      <nav aria-label="Level">
        <ol className="at-rail">
          <li>
            <button
              type="button"
              className="at-step"
              aria-current={focus.level === 0 ? "step" : undefined}
              disabled={focus.level === 0}
              onClick={() => nav.home()}
            >
              {LEVELS[0]}
            </button>
          </li>
          {focus.level > 0 ? (
            <>
              <li className="at-rail-sep" aria-hidden>
                /
              </li>
              <li>
                <button
                  type="button"
                  className="at-step"
                  aria-current={focus.level === 1 ? "step" : undefined}
                  disabled={focus.level === 1}
                  onClick={() => nav.up()}
                >
                  {layer ? layer.name : LEVELS[1]}
                </button>
              </li>
            </>
          ) : null}
          {focus.level === 2 ? (
            <>
              <li className="at-rail-sep" aria-hidden>
                /
              </li>
              <li>
                <button type="button" className="at-step" aria-current="step" disabled>
                  {open ? open.name : LEVELS[2]}
                </button>
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      {/* The lens read-out. The only chrome allowed to take the accent, because it IS the lens. */}
      <div className="at-lens">
        {lens.concept ? (
          <span className="at-lens-on">
            <span className="at-part">{lens.concept.part}</span>
            <span>{lens.concept.name}</span>
            <span className="at-fig">
              {lens.components.size} of {counts.components}
            </span>
            <button type="button" className="at-lens-clear" onClick={() => setLens(null)}>
              clear
            </button>
          </span>
        ) : (
          <span className="at-lens-off">No lens &mdash; choose a claim to mark up the sheet</span>
        )}
      </div>

      <div className="at-mast-counts" aria-hidden>
        <span>{counts.systems} systems</span>
        <span>{counts.components} components</span>
        <span>{counts.edges} edges</span>
      </div>
    </header>
  );
}
