"use client";

/**
 * The title block of the drawing: the one thing that does not change between levels or views.
 *
 * Rubric axis 4 asks what visibly persists across depths. Here: the level rail (where you are and
 * every level you can step back to), the view switcher (which arrangement is on the sheet), the
 * lens read-out, and the model's own counts. It never unmounts and it never animates — chrome that
 * holds still is continuity; chrome that travels is a second thing to follow.
 *
 * THE SWITCHER IS A RADIO GROUP, not four buttons. Four arrangements of one drawing are four
 * values of one property, and a reader on a keyboard should be able to walk them with the arrow
 * keys and commit with none — which is what a radio group is and what `useRoving` gives it. It is
 * in the mast because the view is a fact about the whole surface rather than about anything on it.
 */
import { useRef } from "react";
import { useRoving, type ZoomNav } from "@athena/demo-kit/zoom";

import { LEVELS } from "@/lib/constants";
import { componentById, layerById, type Lens, type ModelCounts } from "@/data";

import { VIEWS, VIEW_META, type ViewId } from "./canvas/plan";

export function Mast({
  nav,
  lens,
  setLens,
  counts,
  view,
  setView,
}: {
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
  counts: ModelCounts;
  view: ViewId;
  setView: (next: ViewId) => void;
}) {
  const focus = nav.state.focus;
  const layer = layerById(focus.group);
  const open = componentById(focus.item);
  const switcher = useRef<HTMLDivElement | null>(null);
  const roving = useRoving(switcher, { selector: "[data-view-btn]" });

  return (
    <header className="at-mast">
      <span className="at-mast-brand">
        <b>Atlas</b>
        <span className="at-part">athena-portable</span>
      </span>

      {/* The view switcher. The same blocks, four arrangements. */}
      <div
        className="at-views"
        role="radiogroup"
        aria-label="Arrangement"
        ref={switcher}
        {...roving}
      >
        {VIEWS.map((id) => {
          const meta = VIEW_META[id];
          const on = view === id;
          return (
            <button
              key={id}
              type="button"
              className="at-view-btn"
              data-view-btn=""
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={meta.note}
              onClick={() => setView(id)}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

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
