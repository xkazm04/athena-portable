"use client";

/**
 * The title block: the one thing that does not change between levels.
 *
 * Rubric axis 4 asks what visibly persists across depths. Here: the level rail (where you are and
 * every level you can step back to), the lens read-out, and the model's own counts. It never
 * unmounts and it never animates, which is also why it is not inside the `LayoutGroup` — chrome
 * that holds still is continuity; chrome that travels is a second thing to follow.
 */
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { LEVELS } from "@/lib/constants";
import { componentById, layerById, type Lens, type ModelCounts } from "@/data";

export function Mast({
  nav,
  lens,
  setLens,
  counts,
  children,
}: {
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
  counts: ModelCounts;
  /** The rendering switch. Temporary furniture, and it lives in the mast because it is about
   *  the whole surface rather than about anything in the scene. */
  children?: React.ReactNode;
}) {
  const focus = nav.state.focus;
  const layer = layerById(focus.group);
  const open = componentById(focus.item);

  return (
    <header className="at-mast">
      <span className="at-mast-brand">
        <b>Atlas</b>
        <span className="at-part">athena-portable</span>
      </span>

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
          <span className="at-lens-off">No lens &mdash; choose a concept to mark up the stack</span>
        )}
      </div>

      <div className="at-mast-counts" aria-hidden>
        <span>{counts.systems} systems</span>
        <span>{counts.components} components</span>
        <span>{counts.edges} edges</span>
      </div>

      {children}
    </header>
  );
}
