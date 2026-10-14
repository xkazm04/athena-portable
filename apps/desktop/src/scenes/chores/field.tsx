/**
 * The playbook ledger — README section 3.5, ADR 0040, 0087, 0089 and 0096.
 *
 * The root of the Chores depth, read as a ledger a person picks from: on the left the rail of the
 * ten areas, each with its count under the job in force; in the centre the job chips, the view
 * (Ledger or Map) and the playbooks themselves, a table ordered by the edge until a column's head
 * orders it by money or hours; on the right the preview of the picked one, its process drawn as a
 * blueprint, its real screens, the chore by hand against the chore with her, and what to do with it.
 * The Map is the old hero's edge map over the same rows, so a mark and a row are one pick.
 *
 * The pick follows the filters: a playbook the rail or a chip hides gives the preview to the first
 * row left. Under `LEDGER_WIDE` of the field's own width (the depth frame, not the window) there is
 * no room for the preview, so it is not drawn and a pick opens the chore instead — but only a pick
 * made by a click, Enter or Space: walking the rows with the arrows still only moves the pick, or a
 * keyboard reader could not pass a row without diving into it.
 *
 * Every piece of state here is the view's own; opening a chore is `go`. Nothing here fetches.
 */
import { useEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import ProblemNote from "@/components/ProblemNote";
import type { Path } from "@/depth/model";
import {
  categoryCounts,
  filterLedger,
  sortLedger,
  type CategoryFilter,
  type JobFilter,
  type LedgerSort,
  type PlaybookView,
  type PlaybooksModel,
} from "@/modules/playbooks/model";

import { LedgerTable, Rail, Toolbar, type View } from "./ledger";
import EdgeMap from "./map";
import { EDGE_ORDER, LEDGER_WIDE, SIMULATED_LINE, chorePath, emptyLine, nextSort, pickedRow, totalsLine } from "./model";
import Preview from "./preview";

type Area = CategoryFilter | "uncategorised";

export default function Field({ model, go }: { model: PlaybooksModel; go: (to: Path) => void }) {
  const [area, setArea] = useState<Area>("all");
  const [job, setJob] = useState<JobFilter>("all");
  const [sort, setSort] = useState<LedgerSort>(EDGE_ORDER);
  const [view, setView] = useState<View>("ledger");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [setBox, wide] = useWide(LEDGER_WIDE);
  // How the latest pick was made: a press (click, Enter, Space) or a walk (an arrow, Home, End).
  const how = useRef<"press" | "walk">("press");

  if (model.problem !== null) {
    return (
      <div className="chores ch-field">
        <div className="ch-field__empty">
          <ProblemNote title="The playbooks could not be read." reason={model.problem} />
        </div>
      </div>
    );
  }

  if (model.loading) {
    return (
      <div className="chores ch-field">
        <div className="ch-field__empty">
          <EmptyState title="Loading the playbooks" line="They are fetched the first time they are asked for." />
        </div>
      </div>
    );
  }

  if (model.items.length === 0) {
    return (
      <div className="chores ch-field">
        <div className="ch-field__empty">
          <EmptyState
            title="No playbooks in this build"
            line="A playbook is a directory under playbooks/; the bench writes its proof beside it."
          />
        </div>
      </div>
    );
  }

  const counts = categoryCounts(model.items, job);
  const shown =
    area === "uncategorised"
      ? filterLedger(model.items, { category: "all", job }).filter((v) => v.playbook.category === null)
      : filterLedger(model.items, { category: area, job });
  const rows = sortLedger(shown, sort);
  const picked = pickedRow(rows, pickedId);
  const open = (v: PlaybookView) => go(chorePath(v.id));
  const pick = (v: PlaybookView) => {
    if (!wide && how.current === "press") open(v);
    else setPickedId(v.id);
  };
  const showAll = () => {
    setArea("all");
    setJob("all");
  };
  const empty = emptyLine({ category: area === "uncategorised" ? "all" : area, job });

  return (
    <div className="chores ch-field" ref={setBox}>
      <div className="ch-led" data-wide={wide ? "" : undefined}>
        <Rail counts={counts} value={area} onChange={setArea} />

        <section
          className="ch-centre"
          aria-label="Playbooks"
          onKeyDownCapture={(e) => {
            how.current = e.key === "Enter" || e.key === " " ? "press" : "walk";
          }}
          onClickCapture={() => {
            how.current = "press";
          }}
        >
          <header className="ch-centre__head">
            <p className="ch-eyebrow">Chores</p>
            <h1 className="ch-centre__title">What only Athena does</h1>
            <p className="ch-note ch-totals">{totalsLine(model)}</p>
            <p className="ch-simulated">{SIMULATED_LINE}</p>
          </header>

          <Toolbar job={job} onJob={setJob} view={view} onView={setView} />

          {view === "ledger" ? (
            <LedgerTable
              rows={rows}
              selectedId={picked?.id ?? null}
              onSelect={pick}
              sort={sort}
              onSort={(key) => setSort((s) => nextSort(s, key))}
              empty={empty}
            />
          ) : rows.length ? (
            <EdgeMap items={rows} selectedId={picked?.id ?? null} onSelect={pick} onOpen={open} />
          ) : (
            <p className="ch-body">{empty}</p>
          )}
          {rows.length === 0 ? (
            <div className="ch-none">
              <Button size="sm" variant="secondary" onClick={showAll}>
                {`Show all ${model.items.length}`}
              </Button>
            </div>
          ) : null}
        </section>

        {wide && picked ? <Preview key={picked.id} view={picked} actions={model.actions} onOpen={() => open(picked)} /> : null}
      </div>
    </div>
  );
}

/**
 * Whether an element's own content box is at least `min` px wide, as a callback ref and a flag.
 * Wide until measured: the first frame of a test or a static render draws the full ledger, and the
 * stylesheet's container query, which spells the same number, already lays it out before this
 * observer reports.
 */
function useWide(min: number): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setWide(width >= min);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [setEl, wide];
}
