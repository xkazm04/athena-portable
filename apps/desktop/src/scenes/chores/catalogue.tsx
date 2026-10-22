/**
 * The Chores root: the catalogue — README section 3.5, ADR 0096.
 *
 * Full width, no side rail: the areas are a tab bar with a
 * glyph and a count each, the jobs are chips under it, the order a three-way switch, and the ledger
 * a comfortable list of rows each led by a still of its own run. A press opens the topic page.
 */
import { useEffect, useRef } from "react";

import Button from "@/components/Button";
import Table, { type Column } from "@/components/Table";
import { CATEGORIES, JOBS, categoryLabel, jobLabel, type CategoryId } from "@/lib/playbook-taxonomy";
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

import { EDGE_ORDER, emptyLine, totalsLine, valueCell } from "./model";
import { lead } from "./rich";
import { JOB_TONE, stillsOf, timeCell } from "./facts";
import Glyph from "./glyphs";

export interface CatalogueState {
  category: CategoryFilter;
  job: JobFilter;
  sort: LedgerSort;
  /** The row last opened, picked again on the way back. */
  last: string | null;
}

const SORTS: { id: string; label: string; sort: LedgerSort }[] = [
  { id: "edge", label: "Best edge", sort: EDGE_ORDER },
  { id: "value", label: "Most value", sort: { key: "value", dir: "desc" } },
  { id: "time", label: "Most time saved", sort: { key: "time", dir: "desc" } },
];

const sameSort = (a: LedgerSort, b: LedgerSort) => a.key === b.key && a.dir === b.dir;

export default function Catalogue({
  model,
  state,
  set,
  open,
  create,
}: {
  model: PlaybooksModel;
  state: CatalogueState;
  set: (s: Partial<CatalogueState>) => void;
  open: (view: PlaybookView) => void;
  /** The front door: "New chore". */
  create: () => void;
}) {
  const counts = categoryCounts(model.items, state.job);
  const rows = sortLedger(filterLedger(model.items, { category: state.category, job: state.job }), state.sort);
  // How the latest pick was made: a press opens the topic, a walk (arrow, Home, End) only picks.
  const how = useRef<"press" | "walk">("press");
  const box = useRef<HTMLDivElement>(null);

  // Back from a topic: the row it was opened from is in view and holds the focus.
  useEffect(() => {
    if (state.last === null) return;
    const row = box.current?.querySelector<HTMLElement>('tr[aria-selected="true"]');
    row?.scrollIntoView?.({ block: "center" });
    row?.focus({ preventScroll: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: CategoryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: counts.byCategory[c.id] })),
  ];
  // The tab says the area's first word ("Health"); its full name is its accessible name and title.
  const short = (label: string) => label.split(/\s+(?:&|and)\s+|,\s*/)[0]!;

  const columns: Column<PlaybookView>[] = [
    {
      key: "shot",
      head: "",
      render: (v) => {
        const first = stillsOf(v)[0];
        return first ? (
          <img className="pa-thumb" src={first.url} alt="" loading="lazy" decoding="async" width={128} height={80} />
        ) : (
          <span className="pa-thumb pa-thumb--none" aria-hidden="true">
            <Glyph id={v.playbook.category} size={28} />
          </span>
        );
      },
    },
    {
      key: "name",
      head: "Playbook",
      render: (v) => (
        <span className="pa-name">
          <span className="pa-name__title">{v.playbook.shortTitle}</span>
          <span className="pa-name__lead">{lead(v.playbook.brief) || v.playbook.promise}</span>
          {/* ADR 0127: how many comparable runs the bench stands on; an unbenched row claims nothing. */}
          {v.verdict.runs ? (
            <span className="pa-name__runs pa-muted">
              {v.verdict.runs}
              {v.verdict.sample ? (
                <>
                  {" "}
                  <span className="pa-chip" title="One comparable run: a single draw, not yet repeated">
                    {v.verdict.sample}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "job",
      head: "Job",
      render: (v) =>
        v.playbook.job ? (
          <span className="pa-job" style={{ "--pa-tone": JOB_TONE[v.playbook.job] } as React.CSSProperties}>
            {jobLabel(v.playbook.job)}
          </span>
        ) : (
          <span className="pa-muted">–</span>
        ),
    },
    {
      key: "portals",
      head: "Portals",
      render: (v) => {
        const apps = v.playbook.apps;
        return (
          <span className="pa-portals">
            {apps.slice(0, 3).map((a) => (
              <span key={a.name} className="pa-chip">
                {a.name}
              </span>
            ))}
            {apps.length > 3 ? <span className="pa-chip pa-chip--more">{`+${apps.length - 3}`}</span> : null}
          </span>
        );
      },
    },
    {
      key: "time",
      head: "Time saved",
      align: "right",
      render: (v) => {
        const t = timeCell(v);
        return (
          <span className="pa-time">
            <span className="pa-time__hand">{t.hand}</span>
            <span className="pa-time__arrow" aria-label=" by hand, with Athena ">
              →
            </span>
            <span className="pa-time__athena">{t.athena ?? "not run"}</span>
          </span>
        );
      },
    },
    {
      key: "value",
      head: "Value",
      align: "right",
      render: (v) => {
        const c = valueCell(v);
        return (
          <span className="pa-value">
            <span className="pa-value__n">{c.figure}</span>
            <span className="pa-value__per">{c.per}</span>
          </span>
        );
      },
    },
  ];

  const where = state.category === "all" ? "all areas" : categoryLabel(state.category as CategoryId);

  return (
    <div className="pa-page">
      <div className="pa-wrap">
        <header className="pa-head">
          <h1 className="pa-h1">Chores</h1>
          <p className="pa-totals">{totalsLine(model)}</p>
          <div className="pa-head__new">
            <Button variant="primary" size="sm" onClick={create}>
              New chore
            </Button>
          </div>
        </header>

        <nav className="pa-tabs" aria-label="Areas">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pa-tab focus-ring"
              aria-current={state.category === t.id ? "page" : undefined}
              disabled={t.count === 0 && state.category !== t.id}
              onClick={() => set({ category: t.id })}
              title={t.label}
              aria-label={`${t.label}, ${t.count}`}
            >
              <Glyph id={t.id} size={24} />
              <span className="pa-tab__label">{short(t.label)}</span>
              <span className="pa-tab__count">{t.count}</span>
            </button>
          ))}
        </nav>

        <div className="pa-bar">
          <div className="pa-jobs" role="group" aria-label="Job">
            {[{ id: "all" as const, label: "All jobs" }, ...JOBS].map((j) => (
              <button
                key={j.id}
                type="button"
                className="pa-jobchip focus-ring"
                aria-pressed={state.job === j.id}
                style={j.id === "all" ? undefined : ({ "--pa-tone": JOB_TONE[j.id] } as React.CSSProperties)}
                onClick={() => set({ job: j.id })}
              >
                {j.id === "all" ? null : <span className="pa-dot" aria-hidden="true" />}
                {j.label}
              </button>
            ))}
          </div>
          <div className="pa-sort" role="group" aria-label="Order">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="pa-sort__btn focus-ring"
                aria-pressed={sameSort(state.sort, s.sort)}
                onClick={() => set({ sort: s.sort })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="pa-shown">{`${rows.length} ${rows.length === 1 ? "playbook" : "playbooks"} in ${where}`}</p>

        {rows.length === 0 ? (
          <div className="pa-empty">
            <p>{emptyLine({ category: state.category, job: state.job })}</p>
            <Button variant="primary" onClick={() => set({ category: "all", job: "all" })}>
              Show all
            </Button>
          </div>
        ) : (
          <div
            ref={box}
            className="pa-ledger"
            onPointerDownCapture={() => {
              how.current = "press";
            }}
            onKeyDownCapture={(e) => {
              how.current = e.key === "Enter" || e.key === " " ? "press" : "walk";
            }}
          >
            <Table
              columns={columns}
              rows={rows}
              rowKey={(v) => v.id}
              empty="No playbook here."
              caption="Pick a playbook to open its page."
              selectedKey={state.last}
              onSelect={(v) => {
                set({ last: v.id });
                if (how.current === "press") open(v);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
