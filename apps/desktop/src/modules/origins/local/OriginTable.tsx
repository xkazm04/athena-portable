/**
 * Every origin as a row — the list half of the Origins module.
 *
 * A `Table` rather than a stack of cards, and that is the density win the first build recorded
 * (`README` section 3.5): six of its eight surfaces were designed inside a 380px column and
 * stacked their record lists, so twelve origins could only be compared by scrolling and their
 * figures never aligned. At full width the same twelve sit inside one fold and the two date
 * columns line up, which is the whole reason a person comes to this page.
 *
 * The first cell is the row's name *and* the control that opens its detail; trust is a switch in
 * its own column, because it is a standing permission rather than an act (README section 3.3).
 */
import Badge from "@/components/Badge";
import Table from "@/components/Table";
import type { Column } from "@/components/Table";

import Switch from "./Switch";
import type { OriginLine, OriginsActions } from "../model";

export default function OriginTable({
  origins,
  selected,
  actions,
}: {
  origins: readonly OriginLine[];
  selected: string | null;
  actions: OriginsActions;
}) {
  return (
    <Table
      columns={columns(selected, actions)}
      rows={origins}
      rowKey={(row) => row.origin}
      caption="Every origin Athena has been on, with your ruling on each"
      empty="No origin has taken a row yet."
    />
  );
}

function columns(selected: string | null, actions: OriginsActions): readonly Column<OriginLine>[] {
  return [
    {
      key: "origin",
      head: "Origin",
      render: (row) => (
        <button
          type="button"
          className="origin-row focus-ring"
          aria-expanded={row.origin === selected}
          onClick={() => actions.select(row.origin === selected ? null : row.origin)}
        >
          <span className="row" style={{ gap: 6 }}>
            <span className="typo-title origin-row__host truncate">{row.host}</span>
            {row.current ? <Badge tone="info">here</Badge> : null}
          </span>
          <span className="typo-caption truncate">{row.origin}</span>
        </button>
      ),
    },
    {
      key: "trust",
      head: "Trust",
      render: (row) => (
        <Switch
          checked={row.enabled}
          onChange={(next) => actions.setEnabled(row.origin, next)}
          label={`Athena on ${row.host}`}
        />
      ),
    },
    {
      key: "first",
      head: "First seen",
      render: (row) => <span className="typo-data">{row.firstSeen ?? "—"}</span>,
    },
    {
      key: "last",
      head: "Last seen",
      render: (row) => <span className="typo-data">{row.lastSeen ?? "—"}</span>,
    },
    {
      key: "tools",
      head: "Tools",
      align: "right",
      // `—` is an answer here: the page is not open, so how many tools it has is not known. It
      // is not the same fact as zero and must not read as one.
      render: (row) => (
        <span className="typo-data" title={row.toolCount === null ? "This page is not open" : ""}>
          {row.toolCount ?? "—"}
        </span>
      ),
    },
    {
      key: "overrides",
      head: "Ruled",
      align: "right",
      render: (row) => <span className="typo-data">{row.overrideCount || "—"}</span>,
    },
  ];
}
