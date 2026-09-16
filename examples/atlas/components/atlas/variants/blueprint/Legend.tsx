"use client";

/**
 * THE LEGEND, WHICH IS ALSO THE FILTER. A drawing that does not say what its lines mean is a
 * picture; a legend that cannot be pressed is a caption.
 *
 * ROUND 4'S LEGEND SAID FOUR THINGS and none of them had a number on it: what a run means in this
 * view, what a dashed rule means, what the accent means, and which band the reader is in. The
 * archify study §4's lens is the same object with two changes, and both of them are cheap:
 *
 *   COUNTS. `auto` shows only the kinds PRESENT, with how many of each (study §2's legend.mjs).
 *   A legend row that says "six systems in surfaces" is a small piece of evidence about the model
 *   in its own right — and a row that would say zero is not drawn, because a legend for something
 *   that is not on the sheet is a legend for nothing.
 *
 *   IT FILTERS. Pressing a row lights everything of that kind and dims the rest — dims, never
 *   hides, because the rest of the drawing is the spatial reference that makes the lit part mean
 *   something (study §4: "the rest dimmed as spatial reference"). Pressing it again clears.
 *
 * WHAT IT IS NOT. It is not a second lens: the LENS is the claims rail and it means one thing, a
 * chosen claim, in one accent. The filter is a way of reading the drawing's own grammar — which
 * stratum, which kind of run, what is not built yet — and it takes the ink weight, never the mark.
 * One accent, one meaning, still true (DESIGN.md §2).
 */
import { useMemo, type ReactNode } from "react";

import { LAYERS, type LayerId } from "@/data";

import { VIEW_META, planOf, type ViewId } from "./plan";

const BANDS = ["systems", "components", "one component"] as const;

export type FilterKind = "layer" | "mode" | "status";

export interface Filter {
  kind: FilterKind;
  value: string;
}

export const sameFilter = (a: Filter | null, b: Filter | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.value === b.value);

const MODE_LABEL: Record<string, string> = {
  system: "between systems",
  path: "the turn's legs",
  tether: "second allegiances",
};

/**
 * ONE LEGEND ROW: a swatch, a name, a count, and a press that filters.
 *
 * At module scope rather than inside `Legend`, because a component defined in a render body is a
 * NEW component type on every render — React unmounts and remounts the whole subtree, focus is
 * lost mid-keyboard-walk, and the compiler is right to refuse it.
 */
function Row({
  kind,
  value,
  filter,
  setFilter,
  children,
}: {
  kind: FilterKind;
  value: string;
  filter: Filter | null;
  setFilter: (next: Filter | null) => void;
  children: ReactNode;
}) {
  const on = sameFilter(filter, { kind, value });
  return (
    <button
      type="button"
      className="at-legend-row"
      data-kind={kind}
      data-value={value}
      data-on={on ? "" : undefined}
      aria-pressed={on}
      onClick={() => setFilter(on ? null : { kind, value })}
    >
      {children}
    </button>
  );
}

export function Legend({
  view,
  band,
  runsHidden,
  onToggleRuns,
  filter,
  setFilter,
}: {
  view: ViewId;
  band: 0 | 1 | 2;
  runsHidden: boolean;
  onToggleRuns: () => void;
  filter: Filter | null;
  setFilter: (next: Filter | null) => void;
}) {
  const meta = VIEW_META[view];

  /** Every count on the legend, from the plan itself — one measurement, never a second tally. */
  const counts = useMemo(() => {
    const plan = planOf(view);
    const byLayer = new Map<string, number>();
    for (const b of plan.blocks) byLayer.set(b.layer, (byLayer.get(b.layer) ?? 0) + 1);
    const byMode = new Map<string, number>();
    for (const e of plan.edges) byMode.set(e.mode, (byMode.get(e.mode) ?? 0) + 1);
    const planned = plan.blocks.reduce(
      (n, b) => n + b.parts.filter((p) => p.status !== "built").length,
      0,
    );
    return { byLayer, byMode, planned };
  }, [view]);

  return (
    <div className="at-legend" aria-label="Legend and filter">
      {/* The strata, which are the model's own closed kind set: every block is in exactly one. */}
      <span className="at-legend-group">
        {LAYERS.map((l) => {
          const n = counts.byLayer.get(l.id as LayerId) ?? 0;
          if (n === 0) return null;
          return (
            <Row key={l.id} kind="layer" value={l.id} filter={filter} setFilter={setFilter}>
              <span className="at-legend-swatch" data-layer={l.id} aria-hidden />
              <span className="at-label">{l.name}</span>
              <b className="at-fig">{n}</b>
            </Row>
          );
        })}
      </span>

      {/* What a run means HERE. It means something different in each of the four arrangements. */}
      <span className="at-legend-group">
        {[...counts.byMode].map(([mode, n]) => (
          <Row key={mode} kind="mode" value={mode} filter={filter} setFilter={setFilter}>
            <svg className="at-legend-run" data-mode={mode} viewBox="0 0 40 10" aria-hidden focusable="false">
              <path d="M0 5 L26 5" />
              <path d="M26 0 L36 5 L26 10 z" />
            </svg>
            <span className="at-label">{mode === "system" ? meta.runs : (MODE_LABEL[mode] ?? mode)}</span>
            <b className="at-fig">{n}</b>
          </Row>
        ))}
      </span>

      {counts.planned > 0 ? (
        <Row kind="status" value="planned" filter={filter} setFilter={setFilter}>
          <span className="at-legend-swatch" data-status="planned" aria-hidden />
          <span className="at-label">planned &mdash; not in the tree</span>
          <b className="at-fig">{counts.planned}</b>
        </Row>
      ) : null}

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

      {filter ? (
        <button type="button" className="at-legend-clear" onClick={() => setFilter(null)}>
          Clear filter
        </button>
      ) : null}
    </div>
  );
}
