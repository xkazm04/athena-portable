/**
 * The ledger's rail, its toolbar and its table — README section 3.5, ADR 0096.
 *
 * The rail names the ten areas the taxonomy lists, each with what a press on it would show under
 * the job in force, and "Uncategorised" only while some playbook names no area: a playbook is never
 * hidden for lacking one. It is a list of buttons with `aria-current`, not a `PillGroup`: the
 * catalog keeps that for a setting, and the rail switches what is read. The toolbar holds the job
 * (one at a time, pressed or not) and the view, Ledger or Map. The table is the catalog's one
 * `Table`, its pick and its order the field's state; a row is a playbook's thumbnail, its name and
 * domain, its job, its portals, the hours it takes by hand, its value and its verdict.
 *
 * Nothing here holds state or fetches; the thumbnails are URLs the browser loads lazily.
 */
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Table, { type Column } from "@/components/Table";
import { minutes } from "@/lib/playbooks";
import { CATEGORIES, JOBS, jobLabel, type CategoryId } from "@/lib/playbook-taxonomy";
import type {
  CategoryFilter,
  JobFilter,
  LedgerSort,
  PlaybookView,
  categoryCounts,
} from "@/modules/playbooks/model";

import { valueCell } from "./model";

export type View = "ledger" | "map";

export function Rail({
  counts,
  value,
  onChange,
}: {
  counts: ReturnType<typeof categoryCounts>;
  value: CategoryFilter | "uncategorised";
  onChange: (next: CategoryFilter | "uncategorised") => void;
}) {
  const entries: { id: CategoryFilter | "uncategorised"; label: string; n: number }[] = [
    { id: "all", label: "All", n: counts.all },
    ...CATEGORIES.map((c) => ({ id: c.id as CategoryId, label: c.label, n: counts.byCategory[c.id] })),
    ...(counts.uncategorised > 0
      ? [{ id: "uncategorised" as const, label: "Uncategorised", n: counts.uncategorised }]
      : []),
  ];
  return (
    <nav className="ch-areas" aria-label="Areas">
      <ul className="ch-areas__list">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className="ch-area focus-ring"
              aria-current={e.id === value ? "true" : undefined}
              data-none={e.n === 0 ? "" : undefined}
              onClick={() => onChange(e.id)}
            >
              <span className="ch-area__name">{e.label}</span>
              <span className="ch-area__n ch-data">{e.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Toolbar({
  job,
  onJob,
  view,
  onView,
}: {
  job: JobFilter;
  onJob: (next: JobFilter) => void;
  view: View;
  onView: (next: View) => void;
}) {
  const jobs: { id: JobFilter; label: string }[] = [{ id: "all", label: "Every job" }, ...JOBS];
  return (
    <div className="ch-toolbar">
      <div className="ch-toolbar__group" role="group" aria-label="Job">
        {jobs.map((j) => (
          <Button
            key={j.id}
            size="sm"
            variant={j.id === job ? "secondary" : "ghost"}
            aria-pressed={j.id === job}
            onClick={() => onJob(j.id)}
          >
            {j.label}
          </Button>
        ))}
      </div>
      <div className="ch-toolbar__group ch-toolbar__view" role="group" aria-label="View">
        {(["ledger", "map"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={v === view ? "secondary" : "ghost"}
            aria-pressed={v === view}
            onClick={() => onView(v)}
          >
            {v === "ledger" ? "Ledger" : "Map"}
          </Button>
        ))}
      </div>
    </div>
  );
}

const COLUMNS: readonly Column<PlaybookView>[] = [
  {
    key: "thumb",
    head: "",
    render: (v) =>
      v.evidence?.thumbnailUrl ? (
        <img className="ch-row__thumb" src={v.evidence.thumbnailUrl} alt="" width={64} height={40} loading="lazy" decoding="async" />
      ) : (
        <span className="ch-row__thumb" aria-hidden="true" />
      ),
  },
  {
    key: "title",
    head: "Playbook",
    render: (v) => (
      <span className="ch-row__name">
        <span className="ch-row__title">{v.title}</span>
        <span className="ch-note">{v.playbook.domain}</span>
      </span>
    ),
  },
  { key: "job", head: "Job", render: (v) => <span className="ch-note ch-row__job">{jobLabel(v.playbook.job)}</span> },
  { key: "portals", head: "Portals", align: "right", render: (v) => <span className="ch-data">{v.playbook.apps.length}</span> },
  {
    key: "time",
    head: "Time saved",
    align: "right",
    sortable: true,
    render: (v) => (
      <span className="ch-row__fig">
        <span className="ch-data">{v.playbook.economics.manualMinutes ? minutes(v.playbook.economics.manualMinutes) : "–"}</span>
        <span className="ch-note">{v.speed || "by hand"}</span>
      </span>
    ),
  },
  {
    key: "value",
    head: "Value",
    align: "right",
    sortable: true,
    render: (v) => {
      const cell = valueCell(v);
      return (
        <span className="ch-row__fig">
          <span className="ch-data">{cell.figure}</span>
          <span className="ch-note">{cell.per}</span>
        </span>
      );
    },
  },
  { key: "verdict", head: "Verdict", render: (v) => <Badge tone={v.verdict.tone}>{v.verdict.label}</Badge> },
];

export function LedgerTable({
  rows,
  selectedId,
  onSelect,
  sort,
  onSort,
  empty,
}: {
  rows: readonly PlaybookView[];
  selectedId: string | null;
  onSelect: (view: PlaybookView) => void;
  sort: LedgerSort;
  onSort: (key: "value" | "time") => void;
  empty: string;
}) {
  return (
    <div className="ch-roster">
      <Table
        columns={COLUMNS}
        rows={rows}
        rowKey={(v) => v.id}
        empty={empty}
        selectedKey={selectedId}
        onSelect={onSelect}
        sort={sort.key === "edge" ? null : sort}
        onSort={(key) => {
          if (key === "value" || key === "time") onSort(key);
        }}
      />
    </div>
  );
}
