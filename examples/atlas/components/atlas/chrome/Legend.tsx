"use client";

/**
 * THE LEGEND. A drawing that does not say what its lines mean is a picture.
 *
 * Four things, and no more: what a run means in THIS view (it means something different in each
 * of the four), what a dashed rule means (planned — designed and not in the tree), what the
 * accent means (the lens, and only the lens), and where the reader is standing in the three bands.
 *
 * The band read-out is here rather than in the mast because it is about the DRAWING, not about the
 * model: the mast says which layer is open, and that is a fact about the level; this says whether
 * the sheet is currently showing system names or component names, which is a fact about the zoom.
 * Rule 13's other half — a rendering band is not a navigation level — made visible.
 */
import { VIEW_META, type ViewId } from "../canvas/plan";

const BANDS = ["systems", "components", "one component"] as const;

export function Legend({
  view,
  band,
  runsHidden,
  onToggleRuns,
}: {
  view: ViewId;
  band: 0 | 1 | 2;
  runsHidden: boolean;
  onToggleRuns: () => void;
}) {
  const meta = VIEW_META[view];
  return (
    <div className="at-legend" aria-label="Legend">
      <span className="at-legend-item">
        <svg className="at-legend-run" viewBox="0 0 40 10" aria-hidden focusable="false">
          <path d="M0 5 L26 5" />
          <path d="M26 0 L36 5 L26 10 z" />
        </svg>
        <span className="at-label">{meta.runs}</span>
      </span>

      <span className="at-legend-item">
        <span className="at-legend-swatch" data-status="planned" aria-hidden />
        <span className="at-label">planned — not in the tree</span>
      </span>

      <span className="at-legend-item">
        <span className="at-legend-swatch" data-mark aria-hidden />
        <span className="at-label">the lens</span>
      </span>

      <span className="at-legend-item at-legend-band">
        <span className="at-label">showing</span>
        <b className="at-fig">{BANDS[band]}</b>
      </span>

      {view === "packages" ? (
        <button
          type="button"
          className="at-legend-toggle"
          aria-pressed={!runsHidden}
          onClick={onToggleRuns}
        >
          {runsHidden ? "Show imports" : "Hide imports"}
        </button>
      ) : null}
    </div>
  );
}
