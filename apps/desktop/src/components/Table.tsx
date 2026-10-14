/**
 * @catalog The app's one table: a columns array with a render per column and a required `empty`.
 *
 * House style §3.2, the first of the three density wins: six of the first build's eight surfaces
 * were designed inside a 380px column and stacked their record lists. At full width a table shows
 * three to five times as many rows in the same height, and its figures align, which stacked rows
 * cannot do.
 *
 * `empty` is required rather than optional because "nothing here" is an answer a reader needs,
 * and every table that made it optional shipped a blank rectangle.
 *
 * **Selection and sort are the caller's state** (ADR 0096). With `onSelect` the table is a `grid`
 * whose rows are picked: one tab stop, on the selected row or else the first, and ↑/↓/Home/End move
 * the selection and the focus together, as `PillGroup` moves its radio — a list a person walks to
 * preview each row is read faster when the preview follows the arrow than when every step waits
 * for an Enter. Enter, Space and a click pick the row under them. Without `onSelect` nothing about
 * the table changes: no tab stop, no `aria-selected`, no role. A `sortable` column's head is a
 * button that calls `onSort(key)` and carries `aria-sort`; which way it runs is the caller's.
 */
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface Column<Row> {
  key: string;
  head: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
  /** Its head is a button that asks the caller to sort by `key`; `onSort` must be set. */
  sortable?: boolean;
}

export type TableSort = { key: string; dir: "asc" | "desc" };

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export default function Table<Row>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  selectedKey = null,
  onSelect,
  sort = null,
  onSort,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string | number;
  empty: string;
  caption?: string;
  /** The row the caller has picked; `null` or absent when none is. */
  selectedKey?: string | number | null;
  /** Set it and the rows become selectable; the table reports a pick and holds no state of its own. */
  onSelect?: (row: Row) => void;
  /** The order the caller has the rows in, by a column's `key`; `null` when no column orders them. */
  sort?: TableSort | null;
  onSort?: (key: string) => void;
}) {
  const refs = useRef<(HTMLTableRowElement | null)[]>([]);
  const selectable = onSelect !== undefined;
  const selectedIndex = rows.findIndex((row) => rowKey(row) === selectedKey);
  const stop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, i: number) => {
    // A key pressed on a control inside a cell is that control's.
    if (!onSelect || e.target !== e.currentTarget) return;
    let to: number | null = null;
    if (e.key === "ArrowDown") to = Math.min(i + 1, rows.length - 1);
    if (e.key === "ArrowUp") to = Math.max(i - 1, 0);
    if (e.key === "Home") to = 0;
    if (e.key === "End") to = rows.length - 1;
    if (e.key === "Enter" || e.key === " ") to = i;
    if (to === null) return;
    e.preventDefault();
    refs.current[to]?.focus();
    const row = rows[to];
    if (row !== undefined) onSelect(row);
  };

  return (
    <div className="table-scroll">
      <table className={selectable ? "table is-selectable" : "table"} role={selectable ? "grid" : undefined}>
        {caption ? <caption className="typo-caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = sort?.key === c.key ? sort.dir : null;
              const sortable = Boolean(c.sortable && onSort);
              const className = [c.align === "right" ? "is-right" : "", sortable ? "is-sortable" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <th
                  key={c.key}
                  className={className || undefined}
                  scope="col"
                  aria-sort={sortable ? (sorted ? ARIA_SORT[sorted] : "none") : undefined}
                >
                  {sortable ? (
                    <button type="button" className="table__sort" onClick={() => onSort?.(c.key)}>
                      {c.head}
                      <span className="table__sort-mark" aria-hidden="true" data-dir={sorted ?? undefined} />
                    </button>
                  ) : (
                    c.head
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="table__empty typo-caption" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = rowKey(row);
              const cells = columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "is-right" : undefined}>
                  {c.render(row)}
                </td>
              ));
              if (!selectable) return <tr key={key}>{cells}</tr>;
              return (
                <tr
                  key={key}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  aria-selected={key === selectedKey}
                  tabIndex={i === stop ? 0 : -1}
                  onClick={() => onSelect(row)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                >
                  {cells}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
